import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";

// Assets temporary upload directory (relative to project root)
export const TEMP_DIR = path.resolve(process.cwd(), "assets", "temp");

// Ensure assets/temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export function formatUniqueFilename(originalName: string, userId?: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const userSuffix = userId && userId.length >= 5 ? userId.slice(-5) : userId || "guest";
  const sanitizedOriginalName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");

  return `${dateStr}-${userSuffix}-${sanitizedOriginalName}`;
}

/**
 * Disk storage engine for Multer
 * Stores uploaded files in assets/temp with date-time-userId suffix
 */
export const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req: any, file, cb) => {
    const userId = req?.user?.id || req?.userId;
    cb(null, formatUniqueFilename(file.originalname, userId));
  },
});

/**
 * Memory storage engine for Multer
 */
export const memoryStorage = multer.memoryStorage();

export const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit for lectures, audio, and large PDFs
  },
});

export interface UploadedFileMetadata {
  filepath: string;
  originalName: string;
  filename: string;
  mimetype: string;
  size: number;
}

/**
 * Helper for Next.js App Router (which uses Web standard Request / FormData)
 * Takes a Web File from request.formData() and saves it to assets/temp/
 */
export async function saveFileToDisk(
  file: File,
  userId?: string,
  targetDir: string = TEMP_DIR
): Promise<UploadedFileMetadata> {
  await mkdir(targetDir, { recursive: true });

  const filename = formatUniqueFilename(file.name, userId);
  const filepath = path.join(targetDir, filename);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await writeFile(filepath, buffer);

  return {
    filepath,
    filename,
    originalName: file.name,
    mimetype: file.type,
    size: file.size,
  };
}

export { multer };
export default upload;
