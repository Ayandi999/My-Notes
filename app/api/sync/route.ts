import { NextResponse } from "next/server";
import { headers } from "next/headers";
import fs from "node:fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { processPdf } from "@/utils/text-extraction";
import { storeAudio } from "@/utils/store-audio";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { fileId } = body;

    if (!fileId) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: fileId" },
        { status: 400 }
      );
    }

    // 1. Fetch file record from DB
    const [fileRecord] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.userId, session.user.id)));

    if (!fileRecord) {
      return NextResponse.json(
        { success: false, error: "File not found or access denied" },
        { status: 404 }
      );
    }

    const localPath = fileRecord.localPath;

    if (!localPath || !fs.existsSync(localPath)) {
      return NextResponse.json(
        {
          success: false,
          error: "Local file cannot be found on server to process. Please re-upload.",
        },
        { status: 400 }
      );
    }

    // 2. Set status to 'syncing'
    await db
      .update(files)
      .set({ syncStatus: "syncing", updatedAt: new Date() })
      .where(eq(files.id, fileId));

    const isPdf =
      fileRecord.mimeType === "application/pdf" ||
      fileRecord.name.toLowerCase().endsWith(".pdf");

    const isAudio =
      fileRecord.mimeType?.startsWith("audio/") ||
      fileRecord.mimeType?.startsWith("video/") ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv)$/i.test(fileRecord.name) ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv)$/i.test(fileRecord.realName || "") ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv)$/i.test(fileRecord.givenName || "");

    // 3. Process into Qdrant Vector DB
    try {
      if (isPdf) {
        await processPdf(localPath, {
          fileId: fileRecord.id,
          userId: fileRecord.userId || session.user.id,
          collectionName: process.env.QDRANT_COLLECTION_NAME || "memory",
        });
      } else if (isAudio) {
        await storeAudio(localPath, {
          fileId: fileRecord.id,
          userId: fileRecord.userId || session.user.id,
          audioUrl: fileRecord.url,
          collectionName: process.env.QDRANT_COLLECTION_NAME || "memory",
        });
      } else {
        throw new Error(
          `Unsupported file format for embedding: ${fileRecord.name}`
        );
      }

      // 4. Mark as 'synced' upon completion
      const [syncedRecord] = await db
        .update(files)
        .set({ syncStatus: "synced", updatedAt: new Date() })
        .where(eq(files.id, fileId))
        .returning();

      // 5. Immediately delete temporary local file
      if (fs.existsSync(localPath)) {
        try {
          await fs.promises.unlink(localPath);
        } catch (unlinkErr) {
          console.warn("[Sync Route] Warning: could not delete local file:", unlinkErr);
        }
      }

      return NextResponse.json({
        success: true,
        file: syncedRecord,
      });
    } catch (syncErr: any) {
      console.error("Vector DB synchronization failed:", syncErr);

      // Revert status to 'not synced'
      const [failedRecord] = await db
        .update(files)
        .set({ syncStatus: "not synced", updatedAt: new Date() })
        .where(eq(files.id, fileId))
        .returning();

      return NextResponse.json(
        {
          success: false,
          error: syncErr?.message || "Sync failed",
          file: failedRecord,
        },
        { status: 500 }
      );
    }
  } catch (err: any) {
    console.error("Sync route error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
