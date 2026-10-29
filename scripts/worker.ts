import dotenv from "dotenv";
dotenv.config();

import { createFileSyncWorker } from "@/lib/queue/sync-worker";

console.log("=========================================");
console.log("🚀 Starting BullMQ File Sync Worker...");
console.log("Listening for jobs on 'file-sync-queue'...");
console.log("=========================================");

const worker = createFileSyncWorker();

process.on("SIGINT", async () => {
  console.log("Shutting down worker...");
  await worker.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down worker...");
  await worker.close();
  process.exit(0);
});
