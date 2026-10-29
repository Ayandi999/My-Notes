import { Worker, Job } from "bullmq";
import fs from "node:fs";
import { getRedisConnectionOptions } from "./redis";
import { FILE_SYNC_QUEUE_NAME, FileSyncJobData } from "./sync-queue";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { processPdf } from "@/utils/text-extraction";
import { storeAudio } from "@/utils/store-audio";
import {
  uploadToCloudinary,
  isCloudinaryConfigured,
} from "@/utils/cloudinary-utils";

/**
 * Core processor for syncing a single file into Cloudinary & Qdrant,
 * then immediately deleting the local temporary asset.
 */
export async function processFileSyncJob(job: Job<FileSyncJobData>) {
  const { fileId, localPath, name, mimeType } = job.data;
  console.log(`[Worker] Processing sync job ${job.id} for file: ${name}`);

  if (!fs.existsSync(localPath)) {
    throw new Error(`Local file not found at: ${localPath}`);
  }

  // 1. Mark status as 'syncing'
  await db
    .update(files)
    .set({ syncStatus: "syncing", updatedAt: new Date() })
    .where(eq(files.id, fileId));

  let finalUrl = "";

  try {
    // 2. Upload to Cloudinary if configured and not yet uploaded
    if (isCloudinaryConfigured()) {
      try {
        const cloudResult = await uploadToCloudinary(localPath);
        finalUrl = cloudResult.url;

        await db
          .update(files)
          .set({
            url: cloudResult.url,
            cloudinaryPublicId: cloudResult.publicId,
            updatedAt: new Date(),
          })
          .where(eq(files.id, fileId));
      } catch (cloudErr: any) {
        console.warn("[Worker] Cloudinary upload warning:", cloudErr?.message || cloudErr);
      }
    }

    // 3. Process into Qdrant Vector DB
    const isPdf =
      mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");

    const isAudioOrVideo =
      mimeType?.startsWith("audio/") ||
      mimeType?.startsWith("video/") ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv)$/i.test(name);

    if (isPdf) {
      await processPdf(localPath, {
        fileId,
        userId: job.data.userId,
        collectionName: process.env.QDRANT_COLLECTION_NAME || "memory",
      });
    } else if (isAudioOrVideo) {
      await storeAudio(localPath, {
        fileId,
        userId: job.data.userId,
        audioUrl: finalUrl,
        collectionName: process.env.QDRANT_COLLECTION_NAME || "memory",
      });
    } else {
      throw new Error(`Unsupported format for vector sync: ${name}`);
    }

    // 4. Mark status as 'synced' in PostgreSQL database
    await db
      .update(files)
      .set({ syncStatus: "synced", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    console.log(`[Worker] Successfully synced file to Qdrant: ${name}`);

    // 5. Delete temporary local file immediately
    if (fs.existsSync(localPath)) {
      await fs.promises.unlink(localPath);
      console.log(`[Worker] Cleaned up temporary asset from disk: ${localPath}`);
    }

    return { success: true, fileId };
  } catch (err: any) {
    console.error(`[Worker] Sync failed for file ${name}:`, err);

    // Revert status to 'not synced'
    await db
      .update(files)
      .set({ syncStatus: "not synced", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    throw err;
  }
}

/**
 * Creates and returns the BullMQ Worker instance.
 */
export function createFileSyncWorker(): Worker<FileSyncJobData> {
  const worker = new Worker<FileSyncJobData>(
    FILE_SYNC_QUEUE_NAME,
    async (job) => {
      return await processFileSyncJob(job);
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: 2,
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully.`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed with error:`, err?.message || err);
  });

  return worker;
}

export default createFileSyncWorker;
