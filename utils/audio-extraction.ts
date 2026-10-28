import { stat, mkdtemp, readdir, rm, readFile, mkdir, writeFile } from "node:fs/promises";
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
  mode?: "transcribe" | "translate" | "codemix" | "verbatim" | "translit";
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

function getFfmpegBinary(): string {
  return ffmpegPath || "ffmpeg";
}

function getFfprobeBinary(): string {
  return ffprobeStatic.path || "ffprobe";
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
  options?: TranscribeLectureOptions
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
  const mode = options?.mode || "transcribe";

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
  const transcripts: string[] = [];

  // Sort output files to preserve audio chunk sequence
  const sortedFiles = [...outputFiles].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  for (const fileName of sortedFiles) {
    const entry = downloadUrls[fileName];
    const fileUrl = typeof entry === "string" ? entry : entry?.file_url;
    if (!fileUrl) continue;

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) continue;

    const jsonText = await fileRes.text();
    await writeFile(path.join(outDir, fileName), jsonText, "utf-8");

    try {
      const parsed = JSON.parse(jsonText);
      const text =
        parsed.transcript ||
        (Array.isArray(parsed.timestamps)
          ? parsed.timestamps.map((t: any) => t.text).join(" ")
          : "") ||
        (Array.isArray(parsed.diarized_transcript)
          ? parsed.diarized_transcript.map((t: any) => t.transcript).join(" ")
          : "");

      if (text && text.trim().length > 0) {
        transcripts.push(text.trim());
      }
    } catch {
      if (jsonText.trim().length > 0) {
        transcripts.push(jsonText.trim());
      }
    }
  }

  return transcripts.join("\n\n");
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

    // 4. one batch job, all parts, results joined in order
    return await transcribeLecture(parts, path.join(workDir, "out"), options);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export { sarvamClient };
export default lectureToText;
