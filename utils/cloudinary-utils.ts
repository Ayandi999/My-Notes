import { cloudinary } from "@/lib/cloudinary";

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  format?: string;
  resourceType?: string;
  bytes?: number;
}

export interface CloudinaryDeleteResult {
  result: "ok" | "not found" | string;
}

/**
 * Checks if Cloudinary credentials are set in environment variables.
 */
export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Uploads a local file to Cloudinary.
 *
 * @param localPath Absolute or relative path to the local file
 * @param options Upload options (target folder, resourceType)
 * @returns CloudinaryUploadResult with secure url and publicId
 */
export async function uploadToCloudinary(
  localPath: string,
  options?: {
    folder?: string;
    resourceType?: "auto" | "image" | "video" | "raw";
  }
): Promise<CloudinaryUploadResult> {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary credentials (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) are not configured."
    );
  }

  const folder = options?.folder || "notebooklm_uploads";
  const resourceType = options?.resourceType || "auto";

  const response = await cloudinary.uploader.upload(localPath, {
    resource_type: resourceType,
    folder,
  });

  return {
    url: response.secure_url,
    publicId: response.public_id,
    format: response.format,
    resourceType: response.resource_type,
    bytes: response.bytes,
  };
}

/**
 * Deletes an asset from Cloudinary using its public ID.
 *
 * @param publicId Cloudinary public_id of the asset
 * @param resourceType Resource type ("image" | "video" | "raw" | "auto")
 * @returns CloudinaryDeleteResult indicating success or failure
 */
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: "image" | "video" | "raw" | "auto" = "auto"
): Promise<CloudinaryDeleteResult> {
  if (!isCloudinaryConfigured()) {
    return { result: "not configured" };
  }

  const typesToTry: ("image" | "video" | "raw")[] =
    resourceType === "auto"
      ? ["image", "video", "raw"]
      : [resourceType];

  let lastResult = "not found";

  for (const type of typesToTry) {
    try {
      const response = await cloudinary.uploader.destroy(publicId, {
        resource_type: type,
      });

      if (response.result === "ok") {
        return { result: "ok" };
      }
      lastResult = response.result;
    } catch (err: any) {
      lastResult = err?.message || "error";
    }
  }

  return {
    result: lastResult,
  };
}

export { uploadToCloudinary as createCloudinaryAsset };
export { deleteFromCloudinary as deleteCloudinaryAsset };
export default uploadToCloudinary;
