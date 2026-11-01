"use client";

import { useState, DragEvent, ChangeEvent, useRef } from "react";
import {
  UploadCloud,
  FileText,
  Mic,
  File,
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FolderOpen,
  MonitorPlay,
  Link,
  ListVideo,
  RotateCw,
} from "lucide-react";
import { FileRecord } from "@/functions/fetch-all-files";
import {
  parseYouTubeVideoIdFromUrl,
  parseYouTubePlaylistIdFromUrl,
  youtubeWatchUrl,
  youtubeThumbnailUrl,
} from "@/functions/youtube";
import type { YoutubePlaylistItem } from "@/utils/yt-transcript-extraction";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartUpload: (file: globalThis.File) => void;
  /** Receives an ARRAY of canonical watch URLs (single video = array of 1). */
  onStartYoutubeUpload?: (urls: string[]) => void;
  onFileUploaded?: (newFile: FileRecord) => void;
}

type ModalMode = "choose" | "file" | "youtube";

interface YoutubePreview {
  videoId: string;
  title: string;
  thumbnail: string;
  authorName: string;
}

interface YoutubePlaylist {
  playlistId: string;
  title: string;
  items: YoutubePlaylistItem[];
}

export function UploadModal({
  isOpen,
  onClose,
  onStartUpload,
  onStartYoutubeUpload,
}: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<globalThis.File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ModalMode>("choose");

  // --- YouTube link tab state ---
  const [ytUrl, setYtUrl] = useState("");
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytPreview, setYtPreview] = useState<YoutubePreview | null>(null);
  const [isCheckingPreview, setIsCheckingPreview] = useState(false);
  const previewTimerRef = useRef<number | null>(null);

  const [ytPlaylist, setYtPlaylist] = useState<YoutubePlaylist | null>(null);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [ytExcluded, setYtExcluded] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const acceptedTypes = ".pdf,audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma,.webm,.mp4,.mov,.mkv";

  const resetYoutubeState = () => {
    setYtUrl("");
    setYtError(null);
    setYtPreview(null);
    setIsCheckingPreview(false);
    setYtPlaylist(null);
    setIsLoadingPlaylist(false);
    setYtExcluded(new Set());
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const resetModal = () => {
    setSelectedFile(null);
    setError(null);
    setMode("choose");
    resetYoutubeState();
  };

  const closeModal = () => {
    resetModal();
    onClose();
  };

  const returnToChoose = () => {
    // Back to the chooser while preserving drag state
    setSelectedFile(null);
    setError(null);
    resetYoutubeState();
    setMode("choose");
  };

  // =====================================================================
  // FILE MODE (unchanged direct-upload flow)
  // =====================================================================
  const validateAndSetFile = (file: globalThis.File) => {
    if (!file) return;

    setError(null);
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();

    const isPdf =
      type === "application/pdf" ||
      name.endsWith(".pdf");

    const isAudioOrVideo =
      type.startsWith("audio/") ||
      type.startsWith("video/") ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv|mpeg)$/i.test(name);

    if (!isPdf && !isAudioOrVideo) {
      setError("Please select a PDF document or an audio/video file (MP3, WAV, M4A, etc.).");
      return;
    }

    setSelectedFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnter = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const getFilePreviewIcon = (file: globalThis.File) => {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      return <FileText className="w-8 h-8 text-rose-500" />;
    }
    if (type.startsWith("audio/") || type.startsWith("video/") || /\.(mp3|wav|m4a|mp4|mov)$/i.test(name)) {
      return <Mic className="w-8 h-8 text-purple-500" />;
    }
    return <File className="w-8 h-8 text-blue-500" />;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    const fileToUpload = selectedFile;
    resetModal();
    onClose(); // Stop showing the floating window immediately
    onStartUpload(fileToUpload);
  };

  const resetSelection = () => {
    setSelectedFile(null);
    setError(null);
    returnToChoose();
  };

  // =====================================================================
  // YOUTUBE LINK MODE (paste link/playlist -> preview -> add)
  // =====================================================================
  const togglePlaylistItem = (videoId: string) => {
    setYtExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const fetchPlaylistPreview = (value: string, playlistId: string) => {
    setIsLoadingPlaylist(true);
    setYtPlaylist(null);
    setYtExcluded(new Set());

    fetch(`/api/upload/youtube/playlist?url=${encodeURIComponent(playlistId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || "Could not load playlist");
        }
        setYtPlaylist({
          playlistId: data.playlistId,
          title: data.title || "Playlist",
          items: data.items || [],
        });
      })
      .catch((err: any) => {
        setYtError(err?.message || "Could not load playlist");
        setYtPlaylist(null);
      })
      .finally(() => setIsLoadingPlaylist(false));
  };

  const handleYoutubeUrlChange = (value: string) => {
    setYtUrl(value);
    setYtError(null);
    setYtPreview(null);

    // Debounce the probe so we don't fire a request per keystroke
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    if (!value.trim()) {
      setYtPlaylist(null);
      setYtExcluded(new Set());
      setIsLoadingPlaylist(false);
      return;
    }

    const playlistId = parseYouTubePlaylistIdFromUrl(value);
    const videoId = parseYouTubeVideoIdFromUrl(value);

    // A watch URL with ONLY a list= param (no v=) is a playlist link; when both
    // are present the video wins (matches YouTube's own behavior).
    if (playlistId && !videoId) {
      setIsCheckingPreview(false);
      fetchPlaylistPreview(value, playlistId);
      return;
    }

    // Playlist mode trumps back to video mode
    setYtPlaylist(null);
    setYtExcluded(new Set());
    setIsLoadingPlaylist(false);

    if (!videoId) {
      setYtError("That doesn't look like a YouTube link or video ID.");
      return;
    }

    // Instant optimistic thumbnail (no request needed) — refines with oembed
    // title/author once the server preview answers.
    setYtPreview({
      videoId,
      title: "",
      thumbnail: youtubeThumbnailUrl(videoId),
      authorName: "",
    });
    setIsCheckingPreview(true);

    previewTimerRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/upload/youtube/preview?url=${encodeURIComponent(value)}`
        );
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Could not load preview");
        }
        setYtPreview({
          videoId: data.videoId,
          title: data.title || "",
          thumbnail: data.thumbnail || youtubeThumbnailUrl(data.videoId),
          authorName: data.authorName || "",
        });
      } catch {
        // Keep the optimistic thumbnail-only preview on probe failure
      } finally {
        setIsCheckingPreview(false);
      }
    }, 500);
  };

  const selectedPlaylistVideos = (): string[] => {
    if (!ytPlaylist) return [];
    return ytPlaylist.items
      .filter((item) => !ytExcluded.has(item.videoId))
      .map((item) => youtubeWatchUrl(item.videoId));
  };

  const handleAddYoutube = () => {
    if (!onStartYoutubeUpload) {
      setYtError("YouTube links are not available in this session.");
      return;
    }

    let urls: string[] = [];

    if (ytPlaylist) {
      urls = selectedPlaylistVideos();
      if (urls.length === 0) {
        setYtError("All videos are crossed out — keep at least one to add.");
        return;
      }
    } else {
      const videoId = parseYouTubeVideoIdFromUrl(ytUrl);
      if (!videoId) {
        setYtError("That doesn't look like a YouTube link or video ID.");
        return;
      }
      urls = [youtubeWatchUrl(videoId)];
    }

    resetModal();
    onClose();
    onStartYoutubeUpload(urls);
  };

  const ytVideoId = parseYouTubeVideoIdFromUrl(ytUrl);
  const isPlaylistMode = !!ytPlaylist || isLoadingPlaylist;
  const remainingPlaylistCount = ytPlaylist
    ? ytPlaylist.items.filter((item) => !ytExcluded.has(item.videoId)).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside backdrop to close */}
      <div className="absolute inset-0" onClick={closeModal} />

      {/* Modal Dialog Card */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {mode === "youtube"
                ? "Add YouTube Link"
                : mode === "file"
                ? "Add Source File"
                : "Add Source"}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {mode === "youtube"
                ? "Paste a video or playlist link to add as a knowledge source."
                : mode === "file"
                ? "Upload PDF textbooks, lecture audio, or video files."
                : "Pick a YouTube link or upload a local file."}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chooser: pick YouTube link OR direct upload */}
        {mode === "choose" && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("youtube")}
              className="group flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 hover:border-rose-400 dark:hover:border-rose-500 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 transition text-center cursor-pointer"
            >
              <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shadow-inner transition">
                <MonitorPlay className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition">
                  YouTube Link
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Paste a video or playlist link
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("file")}
              className="group flex flex-col items-center gap-3 p-6 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition text-center cursor-pointer"
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner transition">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                  Upload File
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  PDF, MP3, WAV, M4A, MP4
                </p>
              </div>
            </button>
          </div>
        )}

        {/* File-mode content */}
        {mode === "file" && (
          <>
            {/* Error notification */}
            {error && (
              <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs border border-red-200 dark:border-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Dropzone & Native File Picker */}
            {!selectedFile ? (
              <label
                htmlFor="notebooklm-file-input"
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-6 border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 select-none ${
                  isDragging
                    ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/30 scale-[1.01]"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                }`}
              >
                {/* Real input linked to label */}
                <input
                  id="notebooklm-file-input"
                  type="file"
                  accept={acceptedTypes}
                  onClick={(e) => {
                    // Ensure re-selecting same file triggers onChange
                    (e.target as HTMLInputElement).value = "";
                  }}
                  onChange={handleFileChange}
                  className="sr-only"
                />

                <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner pointer-events-none">
                  <UploadCloud className="w-8 h-8" />
                </div>

                <div className="pointer-events-none">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    Drag and drop your file here, or click to browse
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Supports PDF, MP3, WAV, M4A, AAC, MP4
                  </p>
                </div>

                {/* Clickable Action Button */}
                <span className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-sm pointer-events-none">
                  <FolderOpen className="w-4 h-4" />
                  <span>Choose File</span>
                </span>
              </label>
            ) : (
              /* Selected File Preview Card */
              <div className="mt-6 space-y-4">
                <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 shadow-sm flex-shrink-0">
                      {getFilePreviewIcon(selectedFile)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {formatFileSize(selectedFile.size)} • Ready to upload
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={resetSelection}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
                    title="Remove selected file"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={resetSelection}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                  >
                    Choose another
                  </button>

                  <button
                    type="button"
                    onClick={handleUpload}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs transition shadow-sm"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>Upload & Add</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* YouTube-mode content */}
        {mode === "youtube" && (
          <div className="mt-6 space-y-4">
            {/* Link input */}
            <div className="relative">
              <Link className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={ytUrl}
                onChange={(e) => handleYoutubeUrlChange(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... or /playlist?list=..."
                className="w-full pl-10 pr-9 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800/60 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-rose-500/60 focus:border-rose-500 transition"
                spellCheck={false}
              />
              {ytUrl && (
                <button
                  type="button"
                  onClick={() => handleYoutubeUrlChange("")}
                  title="Clear link"
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Input error */}
            {ytError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs border border-red-200 dark:border-red-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{ytError}</span>
              </div>
            )}

            {/* Playlist loading state */}
            {isLoadingPlaylist && (
              <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Loading playlist videos...
                </p>
              </div>
            )}

            {/* PLAYLIST: list with per-video cross-out toggles */}
            {ytPlaylist && !isLoadingPlaylist && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <ListVideo className="w-4 h-4 text-rose-500 flex-shrink-0" />
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
                    {ytPlaylist.title}
                  </p>
                  <span className="text-[11px] text-zinc-400 font-mono flex-shrink-0">
                    {ytPlaylist.items.length} videos
                  </span>
                </div>

                {/* Scrollable video list with cross marks */}
                <div className="max-h-64 overflow-y-auto pr-1 space-y-2">
                  {ytPlaylist.items.map((item) => {
                    const isExcluded = ytExcluded.has(item.videoId);
                    return (
                      <div
                        key={item.videoId}
                        className={`p-2 rounded-xl border flex items-center gap-3 transition ${
                          isExcluded
                            ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 opacity-60"
                            : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40"
                        }`}
                      >
                        <div className="relative w-16 flex-shrink-0 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-200 dark:bg-zinc-700">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={youtubeThumbnailUrl(item.videoId)}
                            alt={item.title}
                            loading="lazy"
                            className="w-full h-auto aspect-video object-cover"
                          />
                          {isExcluded && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                              <X className="w-4 h-4 text-white" />
                            </div>
                          )}
                        </div>

                        <p
                          className={`flex-1 min-w-0 text-xs leading-snug line-clamp-2 ${
                            isExcluded
                              ? "text-zinc-400 line-through"
                              : "text-zinc-800 dark:text-zinc-200"
                          }`}
                        >
                          {item.title || "YouTube video"}
                        </p>

                        {/* Cross mark: toggle keep / drop this video */}
                        <button
                          type="button"
                          title={isExcluded ? "Keep this video" : "Don't add this video"}
                          onClick={() => togglePlaylistItem(item.videoId)}
                          className={`p-1.5 rounded-lg flex-shrink-0 transition ${
                            isExcluded
                              ? "text-zinc-300 dark:text-zinc-600 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              : "text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          }`}
                        >
                          {isExcluded ? (
                            <RotateCw className="w-4 h-4" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SINGLE VIDEO preview card */}
            {!isPlaylistMode && ytPreview && !ytError && (
              <div className="p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex gap-3 items-start">
                <div className="relative w-36 flex-shrink-0 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ytPreview.thumbnail}
                    alt="Video thumbnail"
                    className="w-full h-auto aspect-video object-cover"
                    onError={(e) => {
                      const img = e.target as HTMLInputElement;
                      (img as unknown as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  {isCheckingPreview && (
                    <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white">
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  {isCheckingPreview && !ytPreview.title ? (
                    <p className="text-xs text-zinc-400 animate-pulse">
                      Loading video info...
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-2">
                      {ytPreview.title || "YouTube video"}
                    </p>
                  )}
                  {ytPreview.authorName && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 truncate">
                      {ytPreview.authorName}
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-400 mt-1.5 flex items-center gap-1">
                    <MonitorPlay className="w-3 h-3 text-rose-500" />
                    <span className="font-mono truncate">{ytPreview.videoId}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={returnToChoose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
              >
                Back
              </button>

              <button
                type="button"
                disabled={
                  isCheckingPreview ||
                  isPlaylistMode
                    ? (!!ytPlaylist && remainingPlaylistCount === 0) ||
                      !!ytError ||
                      isLoadingPlaylist
                    : !ytVideoId || !!ytError
                }
                onClick={handleAddYoutube}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <MonitorPlay className="w-4 h-4" />
                <span>
                  {ytPlaylist
                    ? `Add ${remainingPlaylistCount} video${remainingPlaylistCount === 1 ? "" : "s"}`
                    : "Add Video"}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadModal;
