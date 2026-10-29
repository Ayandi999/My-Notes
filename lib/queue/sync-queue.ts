import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./redis";

export const FILE_SYNC_QUEUE_NAME = "file-sync-queue";

export interface FileSyncJobData {
  fileId: string;
  userId?: string;
  localPath: string;
  name: string;
  mimeType?: string | null;
  cloudinaryUrl?: string;
  cloudinaryPublicId?: string;
}

let syncQueue: Queue<FileSyncJobData> | null = null;

export function getFileSyncQueue(): Queue<FileSyncJobData> | null {
  if (!syncQueue) {
    try {
      syncQueue = new Queue<FileSyncJobData>(FILE_SYNC_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      });

      // Trap error events on the Queue to avoid uncaught EventEmitter exceptions
      syncQueue.on("error", (err) => {
        console.warn("[Queue] BullMQ Redis connection warning:", err.message);
      });
    } catch (e: any) {
      console.warn("[Queue] Could not initialize BullMQ queue:", e?.message || e);
      return null;
    }
  }
  return syncQueue;
}

/**
 * Enqueues a file sync job to be processed by the BullMQ worker.
 * Times out after 1.5 seconds if Redis is unreachable to avoid blocking upload requests.
 */
export async function addFileSyncJob(data: FileSyncJobData) {
  try {
    const queue = getFileSyncQueue();
    if (!queue) return null;

    const addPromise = queue.add(`sync-${data.fileId}`, data, {
      jobId: data.fileId,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis connection timeout")), 1500)
    );

    return await Promise.race([addPromise, timeoutPromise]);
  } catch (err: any) {
    console.warn("[Queue] Warning: Could not enqueue BullMQ job (Redis may be offline):", err?.message || err);
    return null;
  }
}
