/**
 * ============================================================================
 * ARCHITECTURE & PIPELINE OVERVIEW: YouTube Transcript to Vector DB (Qdrant)
 * ============================================================================
 *
 * GOAL:
 * Take a YouTube video URL (watch, youtu.be, shorts, embed, live), fetch its
 * transcript with EXACT timestamps, and store it in Qdrant Vector DB for
 * semantic RAG search — reusing the SAME chunking + storage strategy as
 * `store-audio.ts` so the frontend can treat retrieved chunks identically
 * (clickable timestamps, inline citations, targeted deletion by fileId).
 *
 * TRANSPORT — `youtube-transcript` PACKAGE:
 * YouTube aggressively bot-walls anonymous caption downloads (HTTP 200 with
 * EMPTY bodies, "Sign in to confirm you're not a bot" on innertube clients,
 * PO-token requirements). The `youtube-transcript` package maintains working
 * workarounds for all of this upstream, so it is used as the sole fetch
 * transport. WE NEVER DOWNLOAD OR STORE THE VIDEO ITSELF — only caption text.
 *
 *   ⚠️ QUIRK: the package returns `offset` / `duration` in MILLISECONDS even
 *   though the field names suggest seconds. We convert to float SECONDS here so
 *   our VttCue[] stays in the same unit system as `store-audio.ts`.
 *
 * REUSED MULTI-TIER TIMESTAMP CHUNKING (same as audio):
 * 1. "pageContent" holds pure, clean prose for high-quality embedding vectors.
 * 2. "metadata" stores chunk-level start/end timestamps and the videoUrl so the
 *    UI can deep-link to `https://youtu.be/<id>?t=<seconds>` for playback.
 * 3. "metadata.cues" preserves the granular cue-level timestamp array inside
 *    each chunk so any sub-sentence can be pinpointed to its exact second.
 * 4. Citations: retrieval builds timestamps from payload.metadata.cues
 *    (formattedTime + videoUrl) — no pre-formatted inline text is stored.
 * 5. metadata.type = "youtube_transcript" (audio chunks use "audio_lecture")
 *    so search results and filters can distinguish sources.
 *
 * DELETION SAFETY: every chunk is stamped with metadata.fileId and
 * metadata.userId (same convention as audio/PDF), which is exactly what
 * `deleteFromQdrantByFileId` filters on — deleting a file removes both the DB
 * row and ALL of its video chunks from Qdrant.
 *
 * PIPELINE STEPS:
 * Step 1: Validate the URL / extract the 11-character video ID.
 * Step 2: Fetch the transcript via the `youtube-transcript` package
 *         (language-preferring) and convert ms cues into seconds-based VttCue[].
 * Step 3: Best-effort fetch the video title via YouTube's public oembed API.
 * Step 4: Group cues into semantic LangChain Documents with cue overlap via
 *         `chunkCuesToDocuments` imported from `store-audio.ts`.
 * Step 5: Verify the Qdrant collection exists (`checkQdrantDbExists` / `initQdrantDb`).
 * Step 6: Embed clean pageContent with OpenAIEmbeddings and persist via
 *         `QdrantVectorStore.fromDocuments`.
 * Step 7: Return store + documents + plain text + VTT + cues for the caller / UI.
 * ============================================================================
 */

import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { YoutubeTranscript } from "youtube-transcript";
import { VttCue, secondsToVttTime } from "./audio-extraction";
import { checkQdrantDbExists, initQdrantDb } from "./init-qdrant-db";
import { chunkCuesToDocuments, formatTimeMmSs } from "./store-audio";

/** A normalized transcript cue in SECONDS (package offsets are milliseconds). */
export interface YoutubeCue extends VttCue {
  /** Caption language that was requested from the transcript transport. */
  language: string;
}

export interface YoutubeTranscriptOptions {
  /**
   * Preferred caption language code (e.g. "en", "hi", "es").
   * Passed straight to the youtube-transcript package; falls back to whatever
   * YouTube serves when no exact match exists. Defaults to "en".
   */
  language?: string;

  /**
   * ONLY accept English-family caption tracks ("en", "en-US", "en-GB"...).
   * When true (the default), a video whose transcript has no English track
   * throws NonEnglishTranscriptError instead of silently embedding another
   * language. Turn off only when multi-language support arrives.
   */
  requireEnglish?: boolean;

  /**
   * Approximate maximum characters per document chunk.
   * Defaults to 900 (same as audio chunks).
   */
  chunkSize?: number;

  /**
   * Number of cues to overlap between adjacent chunks. Defaults to 1.
   */
  cueOverlap?: number;

  /**
   * Unique file ID in Postgres to link vectors for search and deletion.
   */
  fileId?: string;

  /**
   * User ID who owns the file.
   */
  userId?: string;

  /**
   * Target Qdrant collection name. Defaults to QDRANT_COLLECTION_NAME or "memory".
   */
  collectionName?: string;

  /**
   * Qdrant server URL. Defaults to QDRANT_URL or "http://localhost:6333".
   */
  qdrantUrl?: string;

  /**
   * Qdrant API key if authentication is required. Defaults to QDRANT_API_KEY.
   */
  qdrantApiKey?: string;

  /**
   * OpenAI-compatible embedding model. Defaults to OPENAI_EMBEDDING_MODEL
   * or "text-embedding-3-small".
   */
  embeddingModel?: string;

  /**
   * Vector dimension size. Defaults to 1536 for standard OpenAI embeddings.
   */
  vectorSize?: number;
}

export interface YoutubeTranscriptResult {
  /** Canonical watch URL (https://www.youtube.com/watch?v=<id>). */
  videoUrl: string;
  /** 11-character YouTube video id. */
  videoId: string;
  /** Video title via public oembed API (best effort; empty on failure). */
  title: string;
  /** Caption language requested from the transport (e.g. "en"). */
  language: string;
  /** Parsed timestamped cues in SECONDS. */
  cues: YoutubeCue[];
  /** Full transcript joined with spaces (clean text, no timestamps). */
  text: string;
  /** Whole transcript rendered as WebVTT (for subtitle track UI usage). */
  vtt: string;
  store: QdrantVectorStore;
  documents: Document[];
  documentCount: number;
}

/**
 * Extracts the 11-character video ID from any common YouTube URL shape
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/, m.youtube.com) or from a
 * raw ID. Throws when nothing sensible is found.
 */
export function parseYouTubeVideoId(input: string): string {
  const raw = (input || "").trim();

  // Already just an ID?
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  // Normalize missing protocol (e.g. "youtube.com/watch?v=..." or "youtu.be/...")
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      `Invalid YouTube URL or video ID: "${input}". Expected e.g. https://www.youtube.com/watch?v=<id>`
    );
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname;

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = path.split("/").filter(Boolean)[0];
    if (id) return validateYouTubeId(id, input);
  }

  // Only proceed on youtube.com family hosts
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com";
  if (!isYouTube) {
    throw new Error(`Not a YouTube URL: "${input}"`);
  }

  // /watch?v=<id>
  const v = url.searchParams.get("v");
  if (v) return validateYouTubeId(v, input);

  // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
  const match = path.match(/^\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})(?:[/?#]|$)/);
  if (match) return match[1];

  throw new Error(
    `Could not extract a video ID from "${input}". Supported: watch?v=, youtu.be/, /shorts/, /embed/, /live/.`
  );
}

function validateYouTubeId(id: string, original: string): string {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    throw new Error(
      `Video ID "${id}" (from "${original}") is not a valid 11-character YouTube ID.`
    );
  }
  return id;
}

/**
 * Renders cues into a WebVTT document — same shape `audio-extraction` produces,
 * so the frontend can feed it into a <track> element or timestamps UI.
 */
export function buildVttFromCues(cues: VttCue[]): string {
  const lines = ["WEBVTT", ""];
  cues.forEach((cue, index) => {
    lines.push(`${index + 1}`);
    lines.push(`${secondsToVttTime(cue.start)} --> ${secondsToVttTime(cue.end)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Fetches the video title via YouTube's public oembed API. Fails soft —
 * an empty string is returned when oembed is unavailable or the video is private.
 */
export async function fetchYoutubeTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https%3A//www.youtube.com/watch%3Fv%3D${videoId}&format=json`
    );
    if (!res.ok) return "";
    const data: any = await res.json();
    return typeof data?.title === "string" ? data.title.trim() : "";
  } catch {
    return "";
  }
}

export interface YoutubeVideoMetadata {
  videoId: string;
  videoUrl: string;
  /** Video title; empty string when unavailable. */
  title: string;
  /** Thumbnail image URL (YouTube's own hqdefault fallback). */
  thumbnail: string;
  /** Channel / uploader name when available. */
  authorName: string;
}

/**
 * Fetches rich video metadata (title, thumbnail, author) in a single un-
 * authenticated oembed call. Never throws — unknown fields come back empty and
 * the thumbnail always falls back to the predictable i.ytimg.com URL.
 *
 * Used by the dashboard link-preview API and to title YT resource rows.
 */
export async function fetchYoutubeMetadata(
  videoUrlOrId: string
): Promise<YoutubeVideoMetadata> {
  const videoId = parseYouTubeVideoId(videoUrlOrId);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fallback = {
    videoId,
    videoUrl,
    title: "",
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    authorName: "",
  };

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https%3A//www.youtube.com/watch%3Fv%3D${videoId}&format=json`
    );
    if (!res.ok) return fallback;
    const data: any = await res.json();
    return {
      videoId,
      videoUrl,
      title: typeof data?.title === "string" ? data.title.trim() : "",
      thumbnail:
        typeof data?.thumbnail_url === "string" && data.thumbnail_url
          ? data.thumbnail_url
          : fallback.thumbnail,
      authorName: typeof data?.author_name === "string" ? data.author_name.trim() : "",
    };
  } catch {
    return fallback;
  }
}

/**
 * Thrown when the video has caption tracks but NONE of them are English
 * (only-English policy). Carries the available language codes so callers
 * (pipeline/UI) can tell the user what the video actually offers.
 */
export class NonEnglishTranscriptError extends Error {
  availableLanguages: string[];

  constructor(message: string, availableLanguages: string[]) {
    super(message);
    this.name = "NonEnglishTranscriptError";
    this.availableLanguages = availableLanguages;
  }
}

/**
 * Fetches a YouTube transcript through the `youtube-transcript` package and
 * normalizes it into seconds-based YoutubeCue[].
 *
 * Language fallback behavior (English-only policy by default):
 * 1. Tries the requested `language` exactly (default "en").
 * 2. If YouTube reports it missing, parses the "Available languages" list from
 *    the error (e.g. "bn, en-US, hi") and retries with the best English match
 *    ("en" finds "en-US"). Non-English tracks are only tried when
 *    `requireEnglish: false`.
 * 3. With no English track available, throws NonEnglishTranscriptError carrying
 *    the available languages — the UI surfaces this as "video can't be added".
 *
 * @param videoUrlOrId Any supported YouTube URL or a bare 11-char video ID
 */
export async function fetchYoutubeTranscript(
  videoUrlOrId: string,
  options?: YoutubeTranscriptOptions
): Promise<Omit<YoutubeTranscriptResult, "store" | "documents" | "documentCount">> {
  const videoId = parseYouTubeVideoId(videoUrlOrId);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const requestedLanguage = options?.language || "en";
  const requireEnglish = options?.requireEnglish !== false;

  // 1. Fetch transcript parts (offset/duration are MILLISECONDS from the package),
  //    walking a candidate language list until one succeeds
  const candidates = [requestedLanguage];
  let language = requestedLanguage;
  let parts: { text: string; duration: number; offset: number }[] | null = null;
  let lastError: any = null;

  for (let i = 0; i < candidates.length && i < 5; i++) {
    try {
      const fetched = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: candidates[i] });
      if (fetched?.length) {
        language = fetched[0]?.lang || candidates[i];
        parts = fetched;
        break;
      }
      lastError = new Error(`Empty transcript for "${candidates[i]}"`);
    } catch (err: any) {
      lastError = err;
      // On first failure, harvest the languages YouTube says exist and queue
      // the best matches (prefix match first, e.g. "en" -> "en-US")
      if (i === 0) {
        const available = parseAvailableLanguages(err?.message || "");
        if (available.length > 0) {
          if (requireEnglish) {
            const englishAvailable = available.filter((c) => c.toLowerCase().startsWith("en"));
            if (englishAvailable.length === 0) {
              throw new NonEnglishTranscriptError(
                `No English transcript available for video ${videoId} (available: ${available.join(", ")}). Only English transcripts can be added right now.`,
                available
              );
            }
            for (const c of rankLanguages(englishAvailable, "en")) {
              if (!candidates.includes(c)) candidates.push(c);
            }
          } else {
            const ranked = rankLanguages(available, requestedLanguage);
            for (const c of ranked) if (!candidates.includes(c)) candidates.push(c);
          }
        }
      }
    }
  }

  if (!parts) {
    const cause = lastError?.message ? ` (${lastError.message})` : "";
    throw new Error(
      `No captions available for video ${videoId} (requested: "${requestedLanguage}", tried: ${candidates.map((c) => `"${c}"`).join(", ")})${cause}. ` +
      `The video may have disabled "Show transcript", or YouTube bot-blocked this server.`
    );
  }

  // Belt-and-suspenders: even on success, reject a non-English track when the
  // only-English policy is on (covers package-side silent fallbacks).
  if (requireEnglish && !language.toLowerCase().startsWith("en")) {
    throw new NonEnglishTranscriptError(
      `Transcript for video ${videoId} came back in "${language}". Only English transcripts can be added right now.`,
      [language]
    );
  }

  // 2. Normalize into seconds-based cues, timestamp-sorted, deduped.
  //    Only CONSECUTIVE duplicates are dropped (YouTube auto-ASR repeats the
  //    same line back-to-back); a later legit re-appearance is kept.
  const cues: YoutubeCue[] = [];

  for (const part of parts) {
    const text = cleanText(decodeHtmlEntities(part?.text || ""));
    const key = text.toLowerCase();
    const prev = cues[cues.length - 1];
    if (!text || (prev && prev.text.toLowerCase() === key)) continue;

    // Package quirk: offset & duration arrive in milliseconds -> convert to seconds
    const start = (Number(part.offset) || 0) / 1000;
    const duration = (Number(part.duration) || 0) / 1000;

    cues.push({
      start,
      end: start + (duration > 0 ? duration : 2),
      text,
      language,
    });
  }

  cues.sort((a, b) => a.start - b.start);

  if (cues.length === 0) {
    throw new Error(
      `Caption track for ${videoId} (language: ${language}) returned no usable cues.`
    );
  }

  const text = cues.map((c) => c.text).join(" ");
  const vtt = buildVttFromCues(cues);
  const title = await fetchYoutubeTitle(videoId);

  return {
    videoUrl,
    videoId,
    title,
    language,
    cues,
    text,
    vtt,
  };
}

/** Decodes HTML entities commonly found in YouTube captions and oembed responses. */
export function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Whitespace cleanup shared by extraction paths. */
function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * Parses YouTube's caption availability error into raw language codes, e.g.:
 * "No transcripts are available in en this video (abc123). Available languages: bn, en-US, hi"
 * -> ["bn", "en-US", "hi"]
 */
export function parseAvailableLanguages(errorMessage: string): string[] {
  const match = errorMessage.match(/Available languages:\s*([^\r\n.]+)/i);
  if (!match) return [];
  const codes = match[1]
    .split(",")
    .map((code) => code.trim().replace(/["']/g, ""))
    .filter((code) => /^[a-zA-Z]{2,4}(-[a-zA-Z0-9]{2,8})?$/.test(code));
  return Array.from(new Set(codes));
}

/**
 * Ranks available language codes by closeness to a requested code:
 * 1. Exact match ("en" == "en")
 * 2. Prefix match either way ("en" ~ "en-US", "en-US" ~ "en")
 * 3. Everything else, original order preserved
 */
export function rankLanguages(available: string[], requested: string): string[] {
  const req = requested.toLowerCase();
  const exact = available.filter((c) => c.toLowerCase() === req);
  const prefix = available.filter(
    (c) =>
      c.toLowerCase().startsWith(req + "-") || req.startsWith(c.toLowerCase() + "-")
  );
  const rest = available.filter((c) => !exact.includes(c) && !prefix.includes(c));
  return [...exact, ...prefix, ...rest];
}

/**
 * Extracts the playlist list ID from a playlist URL (playlist?list=PL...) or
 * a bare list ID. Also works when a video watch URL carries a list parameter.
 * Throws when no sensible list ID is found.
 */
export function parseYouTubePlaylistId(input: string): string {
  const raw = (input || "").trim();

  // Already just a list ID?
  if (/^[a-zA-Z0-9_-]{12,64}$/.test(raw) && /^(PL|UU|LL|FL|OL|RD|WM)[a-zA-Z0-9_-]*$/.test(raw)) {
    return raw;
  }

  // Normalize missing protocol or relative /playlist paths
  const normalized = raw.startsWith("/playlist") || raw.startsWith("playlist")
    ? `https://www.youtube.com/${raw.replace(/^\/+/, "")}`
    : /^https?:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      `Invalid YouTube playlist URL or ID: "${input}". Expected e.g. https://www.youtube.com/playlist?list=<list id>`
    );
  }

  const list = url.searchParams.get("list");
  if (list && /^[a-zA-Z0-9_-]{12,64}$/.test(list)) return list;

  throw new Error(
    `Could not extract a playlist ID from "${input}". Supported: /playlist?list=<id>, any link with a list= parameter.`
  );
}

export interface YoutubePlaylistItem {
  videoId: string;
  title: string;
}

export interface YoutubePlaylistInfo {
  playlistId: string;
  playlistUrl: string;
  /** Playlist display title (best effort; empty on failure). */
  title: string;
  /** Video entries in playlist order (duplicates removed). */
  items: YoutubePlaylistItem[];
}

/**
 * Recursively collects video entries from arbitrary ytInitialData JSON, so
 * page shape changes (renderer nesting) don't break extraction. Handles BOTH
 * page generations:
 *   - classic: playlistVideoRenderer { videoId, title.runs[] }
 *   - modern (2024+): lockupViewModel { contentId, metadata.lockupMetadataViewModel.title.content }
 */
function collectPlaylistVideoRenderers(node: any, out: YoutubePlaylistItem[]): void {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const child of node) collectPlaylistVideoRenderers(child, out);
    return;
  }

  // Classic renderer
  const classic = node.playlistVideoRenderer;
  if (classic?.videoId && classic.videoId.length === 11) {
    const title =
      (Array.isArray(classic.title?.runs)
        ? classic.title.runs.map((r: any) => r?.text || "").join("")
        : classic.title?.simpleText) || "";
    out.push({ videoId: classic.videoId as string, title: cleanText(decodeHtmlEntities(title)) });
  }

  // Modern renderer
  const lockup = node.lockupViewModel;
  if (lockup?.contentId && typeof lockup.contentId === "string" && lockup.contentId.length === 11) {
    const title =
      lockup.metadata?.lockupMetadataViewModel?.title?.content ||
      lockup.metadata?.lockupMetadataViewModel?.title?.simpleText ||
      "";
    const isPlayable =
      // Non-video lockups (channels, etc.) have no truncated-by-YouTube indicator;
      // guarded/unplayable entries are still included with their title.
      lockup.contentType ? lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" : true;
    if (isPlayable !== false) {
      out.push({ videoId: lockup.contentId, title: cleanText(decodeHtmlEntities(title)) });
    }
  }

  for (const key of Object.keys(node)) {
    collectPlaylistVideoRenderers(node[key], out);
  }
}

/**
 * Fetches all videos of a YouTube playlist by scraping the public playlist
 * page's embedded ytInitialData (no package support + no API key needed).
 *
 * NOTE: returns only the first page (~100 items); very long playlists cover
 * more through pagination, which is a known cap for now.
 */
export async function fetchYoutubePlaylistItems(
  playlistUrlOrId: string
): Promise<YoutubePlaylistInfo> {
  const playlistId = parseYouTubePlaylistId(playlistUrlOrId);
  const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

  // 1. Fetch the playlist page HTML with browser-like headers
  const res = await fetch(playlistUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(
      `YouTube playlist page request failed: HTTP ${res.status} for ${playlistUrl}`
    );
  }

  const html = await res.text();

  if (html.includes("the playlist does not exist") || html.includes("Playlist unavailable")) {
    throw new Error(`Playlist ${playlistId} does not exist or is private.`);
  }

  // 2. Extract the embedded ytInitialData JSON
  const dataMatch =
    html.match(/ytInitialData\s*=\s*(\{.+?\})\s*;/) ||
    html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\})\s*;/);
  if (!dataMatch) {
    throw new Error(
      "Could not locate playlist data on the YouTube page (page shape may have changed)."
    );
  }

  let initialData: any;
  try {
    initialData = JSON.parse(dataMatch[1]);
  } catch {
    throw new Error("Failed to parse YouTube playlist page data.");
  }

  // 3. Walk the tree for video entries (playlistVideoRenderer)
  const items: YoutubePlaylistItem[] = [];
  collectPlaylistVideoRenderers(initialData, items);

  // Dedupe (the page repeats items in continuation/secondary payloads)
  const seen = new Set<string>();
  const uniqueItems = items.filter((item) => {
    if (seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });

  if (uniqueItems.length === 0) {
    throw new Error(`Playlist ${playlistId} returned no videos (it may be empty or private).`);
  }

  // 4. Playlist title (best effort)
  const titleMatch =
    html.match(/"playlistMetadataRenderer":\{"title":"([^"]+)"/) ||
    html.match(/<title>([^<]*)<\/title>/);
  const title = titleMatch
    ? cleanText(decodeHtmlEntities(titleMatch[1])).replace(/\s*-\s*YouTube\s*$/, "")
    : "";

  return {
    playlistId,
    playlistUrl,
    title,
    items: uniqueItems,
  };
}

/**
 * Main exportable function to FETCH, CHUNK, and STORE a YouTube video's
 * transcript in Qdrant — mirroring `storeAudio` storage layout exactly.
 *
 * @param videoUrlOrId Any supported YouTube URL or a bare video ID
 */
export async function storeYoutubeTranscript(
  videoUrlOrId: string,
  options?: YoutubeTranscriptOptions
): Promise<YoutubeTranscriptResult> {
  // 1. Validate URL / video ID, fetch transcript cues
  const transcript = await fetchYoutubeTranscript(videoUrlOrId, options);

  const { cues, text, vtt, videoId, videoUrl, title, language } = transcript;

  // 2. Chunk cues into LangChain Documents (same strategy as audio chunks)
  let splitDocs = chunkCuesToDocuments(cues, {
    chunkSize: options?.chunkSize ?? 900,
    cueOverlap: options?.cueOverlap ?? 1,
    audioUrl: videoUrl, // reference link the UI deep-seek/timestamp-clicks into
    sourcePath: videoUrl, // matches metadata.source used by Qdrant deletion
  });

  // Overrides so RAG results/filters can distinguish YouTube sources.
  // Also strips the shared chunker's inlineTimestampedText — video chunks cite
  // via the granular metadata.cues array instead.
  for (const doc of splitDocs) {
    delete doc.metadata.inlineTimestampedText;
    doc.metadata.type = "youtube_transcript";
    doc.metadata.videoId = videoId;
    doc.metadata.videoUrl = videoUrl;
    doc.metadata.cueLanguage = language;
    if (title) doc.metadata.videoTitle = title;
  }

  // Fallback: single-document storage when chunking yields nothing but text exists
  if (splitDocs.length === 0 && text.trim().length > 0) {
    const firstCue = cues[0];
    splitDocs = [
      new Document({
        pageContent: text.trim(),
        metadata: {
          startTime: firstCue.start,
          endTime: cues[cues.length - 1].end,
          startFormatted: formatTimeMmSs(firstCue.start),
          endFormatted: formatTimeMmSs(cues[cues.length - 1].end),
          startVtt: secondsToVttTime(firstCue.start),
          endVtt: secondsToVttTime(cues[cues.length - 1].end),
          audioUrl: videoUrl,
          source: videoUrl,
          type: "youtube_transcript",
          videoId,
          videoUrl,
          cueLanguage: language,
          videoTitle: title,
          cueCount: 1,
          cues: cues.map((c) => ({
            start: c.start,
            end: c.end,
            formattedTime: formatTimeMmSs(c.start),
            text: c.text,
          })),
        },
      }),
    ];
  }

  if (splitDocs.length === 0) {
    throw new Error(`Transcript for video ${videoId} was fetched but produced no embeddable chunks.`);
  }

  // 3. Attach fileId and userId to chunk metadata for targeted search & deletion
  if (options?.fileId || options?.userId) {
    for (const doc of splitDocs) {
      if (options.fileId) doc.metadata.fileId = options.fileId;
      if (options.userId) doc.metadata.userId = options.userId;
    }
  }

  // 4. Qdrant connection configuration
  const qdrantUrl =
    options?.qdrantUrl || process.env.QDRANT_URL || "http://localhost:6333";
  const rawApiKey = options?.qdrantApiKey ?? process.env.QDRANT_API_KEY;
  const qdrantApiKey =
    rawApiKey && rawApiKey.trim().length > 0 ? rawApiKey.trim() : undefined;
  const collectionName =
    options?.collectionName ||
    process.env.QDRANT_COLLECTION_NAME ||
    "memory";

  // 5. Ensure Qdrant database/collection exists
  const dbExists = await checkQdrantDbExists({
    collectionName,
    url: qdrantUrl,
    apiKey: qdrantApiKey,
  });

  if (!dbExists) {
    await initQdrantDb({
      collectionName,
      url: qdrantUrl,
      apiKey: qdrantApiKey,
      vectorSize: options?.vectorSize ?? 1536,
    });
  }

  // 6. Embeddings using OpenAIEmbeddings
  const embeddingModel =
    options?.embeddingModel ||
    process.env.OPENAI_EMBEDDING_MODEL ||
    process.env.EMBEDDING_MODEL ||
    "openai/text-embedding-3-small";

  const embeddings = new OpenAIEmbeddings({
    model: embeddingModel,
    apiKey: process.env.OPENAI_API_KEY || undefined,
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    },
  });

  // 7. Store documents into Qdrant vector database
  const qdrantStoreOptions: {
    url: string;
    collectionName: string;
    apiKey?: string;
  } = {
    url: qdrantUrl,
    collectionName: collectionName,
  };
  if (qdrantApiKey) {
    qdrantStoreOptions.apiKey = qdrantApiKey;
  }

  const store = await QdrantVectorStore.fromDocuments(splitDocs, embeddings, qdrantStoreOptions);

  return {
    store,
    documents: splitDocs,
    documentCount: splitDocs.length,
    text,
    vtt,
    cues,
    videoId,
    videoUrl,
    title,
    language,
  };
}

export { storeYoutubeTranscript as extractAndStoreYoutubeTranscript };
export default storeYoutubeTranscript;
