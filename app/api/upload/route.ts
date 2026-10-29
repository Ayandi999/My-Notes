import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { saveFileToDisk } from "@/lib/multer";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import {
  uploadToCloudinary,
  isCloudinaryConfigured,
} from "@/utils/cloudinary-utils";
import { addFileSyncJob } from "@/lib/queue/sync-queue";

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file provided in form data ('file' field)" },
        { status: 400 }
      );
    }

    // 1. Resolve user session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    const userId = session?.user?.id;

    // 2. Save file to assets/temp/ with unique name: YYYYMMDD-HHmmss-<last5UserId>-<originalName>
    const savedFile = await saveFileToDisk(file, userId);

    let cloudinaryResult = null;

    // 3. Optional: Upload to Cloudinary if credentials are configured
    if (isCloudinaryConfigured()) {
      try {
        cloudinaryResult = await uploadToCloudinary(savedFile.filepath);
      } catch (cloudErr: any) {
        console.warn("[Upload Route] Cloudinary upload skipped/warning:", cloudErr?.message || cloudErr);
      }
    }

    const fileUrl = cloudinaryResult?.url || `/assets/temp/${savedFile.filename}`;
    const humanSize = formatBytes(savedFile.size);

    // 4. Save to PostgreSQL files table
    const [insertedRecord] = await db
      .insert(files)
      .values({
        userId: userId || null,
        name: savedFile.originalName,
        realName: savedFile.originalName,
        givenName: savedFile.filename,
        url: fileUrl,
        localPath: savedFile.filepath,
        cloudinaryPublicId: cloudinaryResult?.publicId || null,
        mimeType: savedFile.mimetype,
        size: humanSize,
        syncStatus: "not synced",
      })
      .returning();

    // 5. Schedule BullMQ job for background sync and asset cleanup
    try {
      await addFileSyncJob({
        fileId: insertedRecord.id,
        userId: userId || undefined,
        localPath: savedFile.filepath,
        name: savedFile.originalName,
        mimeType: savedFile.mimetype,
        cloudinaryUrl: cloudinaryResult?.url,
        cloudinaryPublicId: cloudinaryResult?.publicId,
      });
    } catch (queueErr) {
      console.warn("[Upload Route] Could not schedule BullMQ job (Redis may be offline):", queueErr);
    }

    return NextResponse.json({
      success: true,
      file: {
        originalName: savedFile.originalName,
        filename: savedFile.filename,
        filepath: savedFile.filepath,
        mimetype: savedFile.mimetype,
        size: humanSize,
      },
      cloudinary: cloudinaryResult,
      record: insertedRecord,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "File upload failed" },
      { status: 500 }
    );
  }
}
