import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  fetchYoutubePlaylistItems,
} from "@/utils/yt-transcript-extraction";

/**
 * GET /api/upload/youtube/playlist?url=<playlist link or list id>
 *
 * Lists all videos of a YouTube playlist so the dashboard modal can render
 * them with per-video cross-out toggles before adding. Requires a signed-in
 * session (adds as user resources right after selection).
 */
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url || !url.trim()) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: url" },
        { status: 400 }
      );
    }

    const playlist = await fetchYoutubePlaylistItems(url);

    return NextResponse.json({
      success: true,
      playlistId: playlist.playlistId,
      playlistUrl: playlist.playlistUrl,
      title: playlist.title,
      itemCount: playlist.items.length,
      items: playlist.items,
    });
  } catch (err: any) {
    console.error("Playlist preview error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Could not load playlist" },
      { status: 400 }
    );
  }
}
