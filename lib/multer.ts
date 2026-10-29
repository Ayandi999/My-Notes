import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";

// Default upload directory (relative to project root)
export const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Disk storage engine for Multer
 * Stores uploaded files with unique timestamps and sanitized original names
 */
export const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${uniqueSuffix}-${sanitizedOriginalName}`);
  },
});

/**
 * Memory storage engine for Multer
 * Holds files as Buffers in memory
 */
export const memoryStorage = multer.memoryStorage();

/**
 * Pre-configured Multer instances
 * - upload: saves files to disk in `uploads/`
 * - uploadMemory: retains files in memory
 */
export const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for lectures, audio, and large PDFs
  },
});

export const uploadMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 100 * 1024 * 1024,
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
 * Takes a Web File from request.formData() and saves it to disk (compatible with lectureToText)
 */
export async function saveFileToDisk(
  file: File,
  targetDir: string = UPLOAD_DIR
): Promise<UploadedFileMetadata> {
  await mkdir(targetDir, { recursive: true });

  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const sanitizedOriginalName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const filename = `${uniqueSuffix}-${sanitizedOriginalName}`;
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
