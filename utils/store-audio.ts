/**
 * ============================================================================
 * ARCHITECTURE & PIPELINE OVERVIEW: Audio Transcription to Vector DB (Qdrant)
 * ============================================================================
 *
 * GOAL:
 * Take an input lecture audio/video file, transcribe and translate it into English,
 * and store it in Qdrant Vector DB for semantic RAG search while preserving EXACT
 * audio playback timestamps for every sentence and chunk.
 *
 * WHY WE DON'T STORE RAW .VTT IN VECTOR DB:
 * Directly storing raw .vtt files (with "WEBVTT", cue IDs, and "00:01:23.450 --> 00:01:28.000")
 * heavily degrades vector embedding quality. Embedding models are trained on natural human
 * prose; timestamp syntax pollutes semantic vector similarity.
 *
 * OUR MULTI-TIER TIMESTAMP CHUNKING STRATEGY:
 * 1. "pageContent" holds pure, clean English prose for high-quality embedding vectors.
 * 2. "metadata" stores chunk-level start/end timestamps (startTime, endTime, formattedTime)
 *    and audioUrl (e.g. from Cloudinary) for direct audio seeking.
 * 3. "metadata.cues" preserves the granular sentence-level timestamp array inside each chunk.
 *    Even if 4-5 sentences are merged into one paragraph, you can pinpoint the exact second
 *    any sub-sentence or concept (e.g. "B-Trees") was uttered!
 * 4. "metadata.inlineTimestampedText" provides pre-formatted "[MM:SS] Text..." tags so that
 *    when sending retrieved context to the LLM, the LLM can cite exact timestamps that become
 *    clickable audio playback buttons in the UI.
 *
 * PIPELINE STEPS:
 * Step 1: Validate local input file path existence.
 * Step 2: Extract audio, normalize, split long files (>55m) using ffmpeg, and transcribe/translate
 *         via Sarvam AI STT (saaras:v4) using `lectureToTranscription`.
 * Step 3: Parse and group timestamped cues into semantic LangChain Documents with overlap.
 * Step 4: Verify if Qdrant collection exists using `checkQdrantDbExists`; if not, initialize with `initQdrantDb`.
 * Step 5: Embed clean pageContent using OpenAIEmbeddings and store documents in QdrantVectorStore.
 * Step 6: Return the store along with the generated documents, plain text, WebVTT track, and cues.
 * ============================================================================
 */

import fs from "node:fs";
import { Document } from "@langchain/core/documents";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import {
  lectureToTranscription,
  VttCue,
  secondsToVttTime,
} from "./audio-extraction";
import { checkQdrantDbExists, initQdrantDb } from "./init-qdrant-db";

export interface StoreAudioOptions {
  /**
   * Unique file ID in Postgres to link vectors for search and deletion.
   */
  fileId?: string;

  /**
   * User ID who owns the file.
   */
  userId?: string;

  /**
   * Target Qdrant collection name. Defaults to process.env.QDRANT_COLLECTION_NAME or "memory".
   */
  collectionName?: string;

  /**
   * OpenAI or compatible embedding model. Defaults to process.env.OPENAI_EMBEDDING_MODEL or "text-embedding-3-small".
   */
  embeddingModel?: string;

  /**
   * Qdrant server URL. Defaults to process.env.QDRANT_URL or "http://localhost:6333".
   */
  qdrantUrl?: string;

  /**
   * Qdrant API key if authentication is required. Defaults to process.env.QDRANT_API_KEY.
   */
  qdrantApiKey?: string;

  /**
   * Public or accessible URL for the audio file (e.g. Cloudinary secure_url).
   * Stored in document metadata so the frontend audio player can stream directly.
   */
  audioUrl?: string;

  /**
   * Approximate maximum characters per document chunk.
   * Defaults to 900 characters (~150-200 words / 40-60 seconds of lecture).
   */
  chunkSize?: number;

  /**
   * Number of cues to overlap between adjacent chunks to prevent cutting context at boundaries.
   * Defaults to 1 cue.
   */
  cueOverlap?: number;

  /**
   * Vector dimension size. Defaults to 1536 for standard OpenAI embeddings.
   */
  vectorSize?: number;

  /**
   * Sarvam STT model. Defaults to "saaras:v4".
   */
  model?: string;

  /**
   * Sarvam translation/transcription mode. Defaults to "translate".
   */
  mode?: "translate" | "transcribe" | "codemix" | "verbatim" | "translit";

  /**
   * BCP-47 language code (e.g. "hi-IN", "en-IN").
   */
  languageCode?: string;

  /**
   * Whether to include speaker diarization. Defaults to false.
   */
  withDiarization?: boolean;
}

export interface StoreAudioResult {
  store: QdrantVectorStore;
  documents: Document[];
  documentCount: number;
  text: string;
  vtt: string;
  cues: VttCue[];
}

/**
 * Formats seconds into a human-readable MM:SS format (e.g. 675s -> "11:15").
 */
export function formatTimeMmSs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * Chunks an array of timestamped VttCues into LangChain Documents.
 * Keeps pageContent clean for high-quality semantic vector embeddings,
 * while embedding precise start/end timestamps and sub-cues into the metadata.
 */
export function chunkCuesToDocuments(
  cues: VttCue[],
  options?: {
    chunkSize?: number;
    cueOverlap?: number;
    audioUrl?: string;
    sourcePath?: string;
  }
): Document[] {
  const maxChars = options?.chunkSize ?? 900;
  const overlap = options?.cueOverlap ?? 1;
  const docs: Document[] = [];

  if (!cues || cues.length === 0) {
    return docs;
  }

  let i = 0;
  while (i < cues.length) {
    let charCount = 0;
    const chunkCues: VttCue[] = [];
    let j = i;

    while (j < cues.length && (charCount < maxChars || chunkCues.length === 0)) {
      chunkCues.push(cues[j]);
      charCount += cues[j].text.length + 1;
      j++;
    }

    if (chunkCues.length > 0) {
      const startTime = chunkCues[0].start;
      const endTime = chunkCues[chunkCues.length - 1].end;
      const combinedText = chunkCues.map((c) => c.text).join(" ");

      // Pre-format inline timestamps: "[10:15] sentence. [10:30] sentence."
      const inlineTimestampedText = chunkCues
        .map((c) => `[${formatTimeMmSs(c.start)}] ${c.text}`)
        .join(" ");

      docs.push(
        new Document({
          pageContent: combinedText, // Pure text for semantic embedding
          metadata: {
            startTime,
            endTime,
            startFormatted: formatTimeMmSs(startTime),
            endFormatted: formatTimeMmSs(endTime),
            startVtt: secondsToVttTime(startTime),
            endVtt: secondsToVttTime(endTime),
            audioUrl: options?.audioUrl || "",
            source: options?.sourcePath || "",
            type: "audio_lecture",
            cueCount: chunkCues.length,
            inlineTimestampedText,
            // Sub-cues preserve every individual sentence timestamp inside this chunk
            cues: chunkCues.map((c) => ({
              start: c.start,
              end: c.end,
              formattedTime: formatTimeMmSs(c.start),
              text: c.text,
              ...(c.speaker ? { speaker: c.speaker } : {}),
            })),
          },
        })
      );
    }

    // Step forward leaving overlap to prevent context fracture at borders
    const nextIndex = Math.max(j - overlap, i + 1);
    if (nextIndex <= i) {
      break;
    }
    i = nextIndex;
  }

  return docs;
}

/**
 * Main exportable function to process, transcribe, chunk, and store an audio file in Qdrant.
 *
 * @param filePath Path to the local audio/video file
 * @param options Optional overrides for transcription, chunking, and Qdrant database
 * @returns StoreAudioResult containing the Qdrant store, chunked documents, text, and VTT
 */
export async function storeAudio(
  filePath: string,
  options?: StoreAudioOptions
): Promise<StoreAudioResult> {
  // 1. Verify file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file does not exist at path: ${filePath}`);
  }

  // 2. Transcribe & translate using Sarvam AI STT via audio-extraction utility
  const transcriptionResult = await lectureToTranscription(filePath, {
    model: options?.model,
    mode: options?.mode,
    languageCode: options?.languageCode,
    withDiarization: options?.withDiarization,
  });

  const { text, vtt, cues } = transcriptionResult;

  // 3. Chunk cues into LangChain Documents with timestamp metadata
  let splitDocs = chunkCuesToDocuments(cues, {
    chunkSize: options?.chunkSize ?? 900,
    cueOverlap: options?.cueOverlap ?? 1,
    audioUrl: options?.audioUrl,
    sourcePath: filePath,
  });

  // Fallback: If no cues could be segmented but full text exists
  if (splitDocs.length === 0 && text.trim().length > 0) {
    splitDocs = [
      new Document({
        pageContent: text.trim(),
        metadata: {
          startTime: 0,
          endTime: 0,
          startFormatted: "00:00",
          endFormatted: "00:00",
          startVtt: "00:00:00.000",
          endVtt: "00:00:00.000",
          audioUrl: options?.audioUrl || "",
          source: filePath,
          type: "audio_lecture",
          cueCount: 1,
          inlineTimestampedText: `[00:00] ${text.trim()}`,
          cues: [{ start: 0, end: 0, formattedTime: "00:00", text: text.trim() }],
        },
      }),
    ];
  }

  // Attach fileId and userId to chunk metadata for targeted search & deletion
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
    "text-embedding-3-small";

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
  };
}

export { storeAudio as extractAndStoreAudio };
export default storeAudio;
