import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export type FileRecord = typeof files.$inferSelect;

/**
 * Fetches all files from the database, optionally filtered by user ID.
 * Ordered by most recent first.
 */
export async function fetchAllFiles(userId?: string): Promise<FileRecord[]> {
  try {
    if (userId) {
      return await db
        .select()
        .from(files)
        .where(eq(files.userId, userId))
        .orderBy(desc(files.createdAt));
    }

    return await db
      .select()
      .from(files)
      .orderBy(desc(files.createdAt));
  } catch (error) {
    console.error("Error fetching files from database:", error);
    return [];
  }
}

export default fetchAllFiles;
