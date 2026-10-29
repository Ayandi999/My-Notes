import { stat, mkdtemp, readdir, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { sarvamClient } from "@/lib/sarvam-clinet";

const execFileP = promisify(execFile);

const MAX_SECONDS = 55 * 60;   // go to split mode above this (55 minutes)
const CHUNK_SECONDS = 50 * 60; // size of each part when splitting (50 minutes)

export interface TranscribeLectureOptions {
  model?: string;
  languageCode?: string;
  mode?: "translate" | "transcribe" | "codemix" | "verbatim" | "translit";
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  withTimestamps?: boolean;
  withDiarization?: boolean;
  outputFormat?: "vtt" | "text" | "json";
}

export interface VttCue {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface LectureTranscriptionResult {
  text: string;
  vtt: string;
  cues: VttCue[];
}

/**
 * Converts a duration in seconds into WebVTT timestamp format: HH:MM:SS.mmm
 */
export function secondsToVttTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const totalMs = Math.round(sec * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${mmm}`;
}

/**
 * Formats an array of VTT cues into a valid WebVTT string.
 */
export function formatAsVtt(cues: VttCue[]): string {
  const lines: string[] = ["WEBVTT", ""];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const startStr = secondsToVttTime(cue.start);
    const endStr = secondsToVttTime(Math.max(cue.end, cue.start + 0.1));

    lines.push(`${i + 1}`);
    lines.push(`${startStr} --> ${endStr}`);
    if (cue.speaker) {
      lines.push(`<v ${cue.speaker}>${cue.text}</v>`);
    } else {
      lines.push(cue.text);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Groups word-level tokens from Sarvam into natural, readable subtitle cues.
 */
export function groupWordsIntoCues(
  words: string[],
  starts: number[],
  ends: number[],
  timeOffset: number = 0
): VttCue[] {
  const cues: VttCue[] = [];
  if (!words.length) return cues;

  let currentWords: string[] = [];
  let currentStart = Number(starts[0] ?? 0);
  let currentEnd = Number(ends[0] ?? currentStart + 0.5);

  for (let i = 0; i < words.length; i++) {
    const word = String(words[i] ?? "").trim();
    if (!word) continue;

    const wStart = Number(starts[i] ?? currentEnd);
    const wEnd = Number(ends[i] ?? wStart + 0.5);

    if (currentWords.length === 0) {
      currentStart = wStart;
    }
    currentWords.push(word);
    currentEnd = wEnd;

    const isPunctuationEnd = /[.!?]$/.test(word);
    const duration = currentEnd - currentStart;
    const isTooLong = currentWords.length >= 8 || duration >= 4.0;
    const isNextGapLarge =
      i + 1 < starts.length && Number(starts[i + 1] ?? 0) - wEnd > 1.0;

    if (isPunctuationEnd || isTooLong || isNextGapLarge || i === words.length - 1) {
      cues.push({
        start: Number((currentStart + timeOffset).toFixed(3)),
        end: Number((currentEnd + timeOffset).toFixed(3)),
        text: currentWords.join(" "),
      });
      currentWords = [];
    }
  }

  return cues;
}

/**
 * Extracts cues and plain text from various possible Sarvam STT JSON formats.
 */
export function extractCuesAndTextFromSarvamJson(
  parsed: any,
  timeOffset: number = 0,
  chunkDuration: number = 0
): { cues: VttCue[]; text: string } {
  const cues: VttCue[] = [];
  let fullText = typeof parsed?.transcript === "string" ? parsed.transcript.trim() : "";

  // 1. Diarized entries
  const diarizedEntries =
    (Array.isArray(parsed?.diarized_transcript?.entries) && parsed.diarized_transcript.entries) ||
    (Array.isArray(parsed?.diarized_transcript) && parsed.diarized_transcript);

  if (diarizedEntries && diarizedEntries.length > 0) {
    for (const entry of diarizedEntries) {
      const entryText = String(entry.transcript || entry.text || "").trim();
      const start = Number(entry.start_time ?? entry.start_time_seconds ?? 0);
      const end = Number(entry.end_time ?? entry.end_time_seconds ?? (start + 1));
      if (entryText) {
        cues.push({
          start: Number((timeOffset + start).toFixed(3)),
          end: Number((timeOffset + end).toFixed(3)),
          text: entryText,
          speaker: entry.speaker_id || entry.speaker,
        });
      }
    }
  }
  // 2. Parallel arrays in timestamps: { words: [], start_time_seconds: [], end_time_seconds: [] }
  else if (
    parsed?.timestamps &&
    Array.isArray(parsed.timestamps.words) &&
    Array.isArray(parsed.timestamps.start_time_seconds)
  ) {
    const wordCues = groupWordsIntoCues(
      parsed.timestamps.words,
      parsed.timestamps.start_time_seconds,
      parsed.timestamps.end_time_seconds || [],
      timeOffset
    );
    cues.push(...wordCues);
  }
  // 3. Array of chunk objects
  else {
    const chunkArray =
      (Array.isArray(parsed?.timestamps?.chunks) && parsed.timestamps.chunks) ||
      (Array.isArray(parsed?.timestamps) && parsed.timestamps);

    if (chunkArray && chunkArray.length > 0) {
      for (const chunk of chunkArray) {
        const chunkText = String(chunk.text || chunk.transcript || "").trim();
        const start = Number(chunk.start_time ?? chunk.start_time_seconds ?? chunk.start_s ?? 0);
        const end = Number(chunk.end_time ?? chunk.end_time_seconds ?? chunk.end_s ?? (start + 1));
        if (chunkText) {
          cues.push({
            start: Number((timeOffset + start).toFixed(3)),
            end: Number((timeOffset + end).toFixed(3)),
            text: chunkText,
          });
        }
      }
    }
  }

  if (!fullText && cues.length > 0) {
    fullText = cues.map((c) => c.text).join(" ");
  }

  // Fallback if timestamps are missing but transcript is present
  if (cues.length === 0 && fullText) {
    cues.push({
      start: Number(timeOffset.toFixed(3)),
      end: Number((timeOffset + (chunkDuration || 5)).toFixed(3)),
      text: fullText,
    });
  }

  return { cues, text: fullText };
}

function getFfmpegBinary(): string {
  let p = (ffmpegPath as string) || "ffmpeg";
  if (p && (p.includes("\\ROOT\\") || p.includes("/ROOT/"))) {
    p = p.replace(/^.*[\\/]ROOT[\\/]/, "");
    p = path.join(/*turbopackIgnore: true*/ process.cwd(), p);
  }
  if (!p || !existsSync(/*turbopackIgnore: true*/ p)) {
    const candidate = path.join(
      /*turbopackIgnore: true*/
      process.cwd(),
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
    if (existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
  }
  return p;
}

function getFfprobeBinary(): string {
  let p = (ffprobeStatic.path as string) || "ffprobe";
  if (p && (p.includes("\\ROOT\\") || p.includes("/ROOT/"))) {
    p = p.replace(/^.*[\\/]ROOT[\\/]/, "");
    p = path.join(/*turbopackIgnore: true*/ process.cwd(), p);
  }
  if (!p || !existsSync(/*turbopackIgnore: true*/ p)) {
    const candidate = path.join(
      /*turbopackIgnore: true*/
      process.cwd(),
      "node_modules",
      "ffprobe-static",
      "bin",
      process.platform,
      process.arch,
      process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
    );
    if (existsSync(/*turbopackIgnore: true*/ candidate)) return candidate;
  }
  return p;
}

export async function run(cmd: "ffmpeg" | "ffprobe" | string, args: string[]) {
  const binary =
    cmd === "ffmpeg"
      ? getFfmpegBinary()
      : cmd === "ffprobe"
      ? getFfprobeBinary()
      : cmd;
  return await execFileP(binary, args);
}

export async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const hasAudio = info.streams?.some((s: any) => s.codec_type === "audio");
    const duration = parseFloat(info.format?.duration);
    if (!hasAudio || !Number.isFinite(duration) || duration <= 0) {
      throw new Error("no audio stream");
    }
    return duration;
  } catch (err: any) {
    throw new Error(`Not a valid audio/video file: ${err?.message || err}`);
  }
}

export async function transcribeLecture(
  parts: string[],
  outDir: string,
  options?: TranscribeLectureOptions,
  partDurations?: number[]
): Promise<string> {
  let apiKey =
    process.env.SARVAM_API_KEY ||
    (sarvamClient as any)?.apiKey ||
    "";

  // If not yet loaded into process.env, load .env from project root
  if (!apiKey || apiKey === "placeholder_sarvam_api_key") {
    try {
      const dotenv = await import("dotenv");
      dotenv.config({ path: path.resolve(process.cwd(), ".env") });
      dotenv.config({ path: path.resolve(__dirname, "../.env") });
      apiKey = process.env.SARVAM_API_KEY || "";
    } catch {
      // ignore
    }
  }

  if (!apiKey || apiKey === "placeholder_sarvam_api_key") {
    throw new Error("SARVAM_API_KEY is not configured in environment variables");
  }

  await mkdir(outDir, { recursive: true });

  const model = options?.model || "saaras:v4";
  // Always default to "translate" mode so the model returns an English translation
  const mode = options?.mode || "translate";
  const withTimestamps = options?.withTimestamps !== false;

  // 1. Initiate bulk job
  const initRes = await fetch("https://api.sarvam.ai/speech-to-text/job/v1", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_parameters: {
        model,
        mode,
        with_timestamps: withTimestamps,
        ...(options?.withDiarization ? { with_diarization: true } : {}),
        ...(options?.languageCode ? { language_code: options.languageCode } : {}),
      },
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`Failed to initialize Sarvam STT job (${initRes.status}): ${errText}`);
  }

  const initData = (await initRes.json()) as { job_id: string; job_state: string };
  const jobId = initData.job_id;

  // 2. Request upload URLs for all audio parts
  const fileNames = parts.map((p) => path.basename(p));
  const uploadLinksRes = await fetch(
    "https://api.sarvam.ai/speech-to-text/job/v1/upload-files",
    {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId,
        files: fileNames,
      }),
    }
  );

  if (!uploadLinksRes.ok) {
    const errText = await uploadLinksRes.text();
    throw new Error(`Failed to get upload links from Sarvam (${uploadLinksRes.status}): ${errText}`);
  }

  const uploadData = (await uploadLinksRes.json()) as {
    upload_urls?: Record<string, { file_url?: string } | string>;
  };

  const uploadUrls = uploadData.upload_urls || {};

  // 3. Upload each file to the designated blob storage
  for (const partPath of parts) {
    const base = path.basename(partPath);
    const entry = uploadUrls[base];
    const uploadUrl = typeof entry === "string" ? entry : entry?.file_url;

    if (!uploadUrl) {
      throw new Error(`No upload URL found for file: ${base}`);
    }

    const fileBuffer = await readFile(partPath);
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": "audio/mpeg",
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Failed to upload ${base} to Sarvam storage (${uploadRes.status}): ${errText}`);
    }
  }

  // 4. Start the job
  const startRes = await fetch(
    `https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/start`,
    {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
      },
    }
  );

  if (!startRes.ok) {
    const errText = await startRes.text();
    throw new Error(`Failed to start Sarvam STT job (${startRes.status}): ${errText}`);
  }

  // 5. Poll until completed
  const pollInterval = options?.pollIntervalMs ?? 5000;
  const maxAttempts = options?.maxPollAttempts ?? 360; // up to 30 minutes
  let attempts = 0;
  let jobState = "Pending";
  let statusData: any = null;

  while (attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    attempts++;

    const statusRes = await fetch(
      `https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/status`,
      {
        headers: {
          "api-subscription-key": apiKey,
        },
      }
    );

    if (!statusRes.ok) {
      continue;
    }

    statusData = await statusRes.json();
    jobState = statusData.job_state || statusData.state;

    if (
      jobState === "Completed" ||
      jobState === "PartiallyCompleted" ||
      jobState === "Failed"
    ) {
      break;
    }
  }

  if (jobState !== "Completed" && jobState !== "PartiallyCompleted") {
    throw new Error(
      `Sarvam STT job did not complete successfully. Final state: ${jobState}. Details: ${JSON.stringify(
        statusData
      )}`
    );
  }

  // 6. Identify output files
  const outputFiles: string[] = [];
  if (Array.isArray(statusData.job_details)) {
    for (const detail of statusData.job_details) {
      if (Array.isArray(detail.outputs)) {
        for (const out of detail.outputs) {
          if (out.file_name) outputFiles.push(out.file_name);
        }
      }
    }
  }

  if (outputFiles.length === 0) {
    for (let i = 0; i < parts.length; i++) {
      outputFiles.push(`${i}.json`);
    }
  }

  // 7. Request download URLs
  const downloadRes = await fetch(
    "https://api.sarvam.ai/speech-to-text/job/v1/download-files",
    {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId,
        files: outputFiles,
      }),
    }
  );

  if (!downloadRes.ok) {
    const errText = await downloadRes.text();
    throw new Error(`Failed to get download URLs from Sarvam (${downloadRes.status}): ${errText}`);
  }

  const downloadData = (await downloadRes.json()) as {
    download_urls?: Record<string, { file_url?: string } | string>;
  };

  const downloadUrls = downloadData.download_urls || {};
  const allCues: VttCue[] = [];
  const textTranscripts: string[] = [];

  // Sort output files to preserve audio chunk sequence
  const sortedFiles = [...outputFiles].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  // Pre-calculate cumulative offsets for each audio chunk
  const cumulativeOffsets: number[] = [0];
  if (partDurations && partDurations.length > 0) {
    for (let i = 0; i < partDurations.length - 1; i++) {
      cumulativeOffsets.push(cumulativeOffsets[i] + partDurations[i]);
    }
  } else {
    for (let i = 0; i < parts.length - 1; i++) {
      cumulativeOffsets.push(cumulativeOffsets[i] + CHUNK_SECONDS);
    }
  }

  for (let i = 0; i < sortedFiles.length; i++) {
    const fileName = sortedFiles[i];
    const entry = downloadUrls[fileName];
    const fileUrl = typeof entry === "string" ? entry : entry?.file_url;
    if (!fileUrl) continue;

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) continue;

    const jsonText = await fileRes.text();
    await writeFile(path.join(outDir, fileName), jsonText, "utf-8");

    const numMatch = fileName.match(/(\d+)/);
    const matchedIndex = numMatch ? parseInt(numMatch[1], 10) : i;
    const partIndex = matchedIndex < parts.length ? matchedIndex : i;
    const offset = cumulativeOffsets[partIndex] ?? (partIndex * CHUNK_SECONDS);
    const chunkDuration = partDurations?.[partIndex] ?? CHUNK_SECONDS;

    try {
      const parsed = JSON.parse(jsonText);
      const { cues, text } = extractCuesAndTextFromSarvamJson(
        parsed,
        offset,
        chunkDuration
      );

      if (text) {
        textTranscripts.push(text);
      }
      allCues.push(...cues);
    } catch {
      if (jsonText.trim().length > 0) {
        textTranscripts.push(jsonText.trim());
        allCues.push({
          start: offset,
          end: offset + chunkDuration,
          text: jsonText.trim(),
        });
      }
    }
  }

  const format = options?.outputFormat || "vtt";

  if (format === "vtt") {
    return formatAsVtt(allCues);
  }
  if (format === "json") {
    return JSON.stringify(
      {
        text: textTranscripts.join("\n\n"),
        vtt: formatAsVtt(allCues),
        cues: allCues,
      },
      null,
      2
    );
  }

  return textTranscripts.join("\n\n");
}

export async function lectureToText(
  inputPath: string,
  options?: TranscribeLectureOptions
): Promise<string> {
  // 1. file exists and is a file
  const s = await stat(inputPath);
  if (!s.isFile()) throw new Error("Path is not a file");

  // 2. valid media + duration
  const duration = await probeDuration(inputPath);

  // 3. normalize (and split only if needed)
  const workDir = await mkdtemp(path.join(tmpdir(), "lecture-"));
  try {
    const encode = [
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
    ];
    const split = duration > MAX_SECONDS;

    await run("ffmpeg", [
      ...encode,
      ...(split
        ? [
            "-f",
            "segment",
            "-segment_time",
            String(CHUNK_SECONDS),
            "-reset_timestamps",
            "1",
            path.join(workDir, "part_%03d.mp3"),
          ]
        : [path.join(workDir, "part_000.mp3")]),
    ]);

    const parts = (await readdir(workDir))
      .filter((f) => f.endsWith(".mp3"))
      .sort()
      .map((f) => path.join(workDir, f));

    if (parts.length > 20) {
      throw new Error("Too long for one job (max 20 files); split into multiple jobs");
    }

    // Measure exact duration of each part to offset timestamps accurately
    const partDurations: number[] = [];
    for (const part of parts) {
      partDurations.push(await probeDuration(part));
    }

    // 4. one batch job, all parts, results formatted as requested (defaults to VTT)
    return await transcribeLecture(
      parts,
      path.join(workDir, "out"),
      options,
      partDurations
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Convenience helper to transcribe directly to WebVTT format.
 */
export async function lectureToVtt(
  inputPath: string,
  options?: Omit<TranscribeLectureOptions, "outputFormat">
): Promise<string> {
  return await lectureToText(inputPath, {
    ...options,
    outputFormat: "vtt",
  });
}

/**
 * Convenience helper to get text, vtt, and raw cues together.
 */
export async function lectureToTranscription(
  inputPath: string,
  options?: TranscribeLectureOptions
): Promise<LectureTranscriptionResult> {
  const jsonStr = await lectureToText(inputPath, {
    ...options,
    outputFormat: "json",
  });
  return JSON.parse(jsonStr) as LectureTranscriptionResult;
}

export { sarvamClient };
export default lectureToText;
