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
 * GET /api/upload/youtube/preview?url=<youtube link or id>
 *
 * Server-side link probe for the dashboard "Add YouTube link" preview card.
 * We proxy YouTube's oembed response from here (instead of calling it from the
 * browser) to avoid any CORS/network restrictions. Returns title, thumbnail,
 * author, and videoId. Non-throwing for unreachable videos — returns
 * thumbnail-only metadata so the UI can still show an instant placeholder.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url || !url.trim()) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: url" },
        { status: 400 }
      );
    }

    const videoId = parseYouTubeVideoId(url);
    const metadata = await fetchYoutubeMetadata(url);

    return NextResponse.json({
      success: true,
      videoId: metadata.videoId || videoId,
      videoUrl: metadata.videoUrl,
      title: metadata.title || "YouTube video",
      thumbnail: metadata.thumbnail,
      authorName: metadata.authorName,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || "Could not load YouTube preview" },
      { status: 400 }
    );
  }
}
