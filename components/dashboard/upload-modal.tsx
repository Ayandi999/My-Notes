"use client";

import { useState, DragEvent, ChangeEvent } from "react";
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
} from "lucide-react";
import { FileRecord } from "@/functions/fetch-all-files";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartUpload: (file: globalThis.File) => void;
  onFileUploaded?: (newFile: FileRecord) => void;
}

export function UploadModal({
  isOpen,
  onClose,
  onStartUpload,
}: UploadModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<globalThis.File | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const acceptedTypes = ".pdf,audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma,.webm,.mp4,.mov,.mkv";

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
    setSelectedFile(null);
    setError(null);
    onClose(); // Stop showing the floating window immediately
    onStartUpload(fileToUpload);
  };

  const resetSelection = () => {
    setSelectedFile(null);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Click outside backdrop to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Dialog Card */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl p-6 sm:p-8 overflow-hidden z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800/80">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Add Source File
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Upload PDF textbooks, lecture audio, or video files.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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
      </div>
    </div>
  );
}

export default UploadModal;
