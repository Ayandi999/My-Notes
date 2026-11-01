import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { files } from "@/lib/db/schema";
import {
  fetchYoutubeMetadata,
  parseYouTubeVideoId,
} from "@/utils/yt-transcript-extraction";

/**
 * POST /api/upload/youtube  { urls: ["<link>", "<link>", ...] }
 *
 * Adds one or MANY YouTube videos as knowledge-base resources WITHOUT
 * uploading any asset: no disk, no Cloudinary, no BullMQ job. Each link gets
 * its own `files` (resource) row recording ONLY the canonical video link:
 *
 *   name / realName = video title (oembed, best effort)
 *   givenName       = the 11-char videoId (lets the UI derive thumbnails)
 *   url             = canonical watch URL — the actual stored "asset"
 *   mimeType        = "video/youtube"  (marker for sidebar + sync routing)
 *   localPath / cloudinaryPublicId / size = NULL (nothing was uploaded)
 *
 * Accepts BOTH shapes for convenience: { urls: string[] } (always produced by
 * the UI — even a single preview becomes an array) and a legacy { url: string }.
 *
 * Partial-failure friendly: valid links still get their rows; invalid ones are
 * reported in `failed` (never aborts the whole batch).
 *
 * Transcript embedding happens later, through the normal sync flow
 * (POST /api/sync -> storeYoutubeTranscript), exactly like files.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);

    // Normalize always to a string[] of links
    const rawLinks: string[] = Array.isArray(body?.urls)
      ? body.urls.filter((u: unknown): u is string => typeof u === "string")
      : typeof body?.url === "string"
      ? [body.url]
      : [];

    if (rawLinks.length === 0 || rawLinks.every((l) => !l.trim())) {
      return NextResponse.json(
        { success: false, error: "Missing required parameter: urls (array of YouTube links)" },
        { status: 400 }
      );
    }

    // 1. Resolve user session (same convention as file upload: null = anonymous)
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    const userId = session?.user?.id;

    // 2. Parse + dedupe all links into canonical video entries
    type ParsedVideo = { videoId: string; videoUrl: string };
    const parsed = new Map<string, ParsedVideo>(); // videoId -> entry (dedupe)
    const failed: { url: string; error: string }[] = [];

    for (const link of rawLinks) {
      try {
        const videoId = parseYouTubeVideoId(link);
        if (!parsed.has(videoId)) {
          parsed.set(videoId, {
            videoId,
            videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
          });
        }
      } catch (err: any) {
        failed.push({ url: link, error: err?.message || "Invalid YouTube URL" });
      }
    }

    const videos = [...parsed.values()];
    if (videos.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid YouTube links provided", failed },
        { status: 400 }
      );
    }

    // 3. Fetch oembed metadata for every video concurrently (batch-friendly)
    const metadataList = await Promise.all(
      videos.map(async (video) => {
        try {
          return await fetchYoutubeMetadata(video.videoUrl);
        } catch {
          // fetchYoutubeMetadata is fail-soft already; belt-and-suspenders fallback
          return {
            videoId: video.videoId,
            videoUrl: video.videoUrl,
            title: "",
            thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
            authorName: "",
          };
        }
      })
    );

    // 4. Insert one LINK-ONLY resource row per video into Postgres
    const records = [];
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const metadata = metadataList[i];
      const displayName = metadata.title || `YouTube video (${video.videoId})`;

      try {
        const [insertedRecord] = await db
          .insert(files)
          .values({
            userId: userId || null,
            name: displayName,
            realName: displayName,
            givenName: video.videoId,
            url: video.videoUrl,
            localPath: null,
            cloudinaryPublicId: null,
            mimeType: "video/youtube",
            size: metadata.authorName ? `Video • ${metadata.authorName}` : "Video",
            syncStatus: "not synced",
          })
          .returning();
        records.push(insertedRecord);
      } catch (rowErr: any) {
        failed.push({
          url: video.videoUrl,
          error: rowErr?.message || "Failed to create resource row",
        });
      }
    }

    if (records.length === 0) {
      return NextResponse.json(
        { success: false, error: "Failed to add any of the provided videos", failed },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      records,
      addedCount: records.length,
      failedCount: failed.length,
      failed,
    });
  } catch (error: any) {
    console.error("YouTube upload error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to add YouTube videos" },
      { status: 500 }
    );
  }
}
