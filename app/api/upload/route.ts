import { NextResponse } from "next/server";
import { saveFileToDisk } from "@/lib/multer";
import { cloudinary } from "@/lib/cloudinary";

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

    // 1. Save file to local uploads directory (useful for ffmpeg & audio extraction)
    const savedFile = await saveFileToDisk(file);

    let cloudinaryResult = null;

    // 2. If Cloudinary credentials are configured, upload to Cloudinary
    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      try {
        const uploadResponse = await cloudinary.uploader.upload(savedFile.filepath, {
          resource_type: "auto",
          folder: "notebooklm_uploads",
        });

        cloudinaryResult = {
          public_id: uploadResponse.public_id,
          secure_url: uploadResponse.secure_url,
          format: uploadResponse.format,
          resource_type: uploadResponse.resource_type,
        };
      } catch (cloudErr: any) {
        console.warn("Cloudinary upload skipped or failed:", cloudErr?.message || cloudErr);
      }
    }

    return NextResponse.json({
      success: true,
      file: {
        originalName: savedFile.originalName,
        filename: savedFile.filename,
        filepath: savedFile.filepath,
        mimetype: savedFile.mimetype,
        size: savedFile.size,
      },
      cloudinary: cloudinaryResult,
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "File upload failed" },
      { status: 500 }
    );
  }
}
