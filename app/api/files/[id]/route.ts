import { NextResponse } from "next/server";
import { headers } from "next/headers";
import fs from "node:fs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { deleteFromCloudinary } from "@/utils/cloudinary-utils";
import { deleteFromQdrantByFileId } from "@/utils/init-qdrant-db";

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
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

    const { id: fileId } = await props.params;

    if (!fileId) {
      return NextResponse.json(
        { success: false, error: "Missing required file ID" },
        { status: 400 }
      );
    }

    // 1. Fetch file record from Postgres
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

    // 2. Remove asset from Cloudinary (if publicId is present)
    let cloudinaryResult = null;
    if (fileRecord.cloudinaryPublicId) {
      try {
        cloudinaryResult = await deleteFromCloudinary(
          fileRecord.cloudinaryPublicId,
          "auto"
        );
        console.log(
          `[Delete Route] Cloudinary delete result for ${fileRecord.cloudinaryPublicId}:`,
          cloudinaryResult
        );
      } catch (cloudErr: any) {
        console.warn(
          "[Delete Route] Cloudinary deletion error:",
          cloudErr?.message || cloudErr
        );
      }
    }

    // 3. Remove all vector embeddings from Qdrant by fileId & localPath metadata
    let qdrantResult = null;
    try {
      qdrantResult = await deleteFromQdrantByFileId(fileRecord.id, {
        localPath: fileRecord.localPath || undefined,
        collectionName: process.env.QDRANT_COLLECTION_NAME || "memory",
      });
      console.log(`[Delete Route] Qdrant vectors removed for fileId ${fileId}`);
    } catch (qdrantErr: any) {
      console.warn(
        "[Delete Route] Qdrant deletion error:",
        qdrantErr?.message || qdrantErr
      );
    }

    // 4. Remove local temporary file if still exists
    if (fileRecord.localPath && fs.existsSync(fileRecord.localPath)) {
      try {
        await fs.promises.unlink(fileRecord.localPath);
        console.log(
          `[Delete Route] Unlinked local file: ${fileRecord.localPath}`
        );
      } catch (unlinkErr) {
        console.warn(
          "[Delete Route] Could not unlink local file:",
          unlinkErr
        );
      }
    }

    // 5. Delete file record from Neon PostgreSQL database
    await db
      .delete(files)
      .where(and(eq(files.id, fileId), eq(files.userId, session.user.id)));

    return NextResponse.json({
      success: true,
      message: "File successfully deleted from Cloudinary, PostgreSQL, and Qdrant",
      fileId,
      cloudinary: cloudinaryResult,
      qdrant: qdrantResult,
    });
  } catch (err: any) {
    console.error("[Delete Route] Unexpected error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
