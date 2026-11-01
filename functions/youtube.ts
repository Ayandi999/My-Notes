/**
 * Client-safe YouTube helpers (NO server imports — usable in React components).
 * Only for display/validation in the UI; server routes use the stricter
 * `parseYouTubeVideoId` from utils/yt-transcript-extraction.
 */

/**
 * Extracts an 11-character video ID from common YouTube URL shapes or a raw
 * ID. Returns null instead of throwing (appropriate for input validation).
 */
export function parseYouTubeVideoIdFromUrl(input: string | null | undefined): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // Bare 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube = host === "youtu.be" || host === "youtube.com" || host === "m.youtube.com";
  if (!isYouTube) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

  const match = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * True when a file row represents a YouTube video resource.
 * The upload route marks these rows with mimeType "video/youtube".
 */
export function isYouTubeSource(file: {
  url?: string | null;
  mimeType?: string | null;
}): boolean {
  if (file.mimeType === "video/youtube") return true;
  return !!file.url && /youtube\.com|youtu\.be/.test(file.url);
}

/**
 * Standard YouTube thumbnail for a video ID (no API needed).
 * hqdefault is always available (letterboxed when no HD thumb exists).
 */
export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Canonical watch URL for a video ID — the resource URL stored in the DB.
 */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Extracts a playlist list ID from a playlist URL (/playlist?list=...) or any
 * link carrying a list= parameter, or a bare list ID. Returns null instead of
 * throwing (appropriate for input validation in the UI).
 */
export function parseYouTubePlaylistIdFromUrl(input: string | null | undefined): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;

  // Bare list ID
  if (/^(PL|UU|LL|FL|OL|RD|WM)[a-zA-Z0-9_-]{6,62}$/.test(raw)) return raw;

  const normalized = raw.startsWith("/playlist") || raw.startsWith("playlist")
    ? `https://www.youtube.com/${raw.replace(/^\/+/, "")}`
    : /^https?:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const list = url.searchParams.get("list");
  if (list && /^[a-zA-Z0-9_-]{12,64}$/.test(list)) return list;

  return null;
}
