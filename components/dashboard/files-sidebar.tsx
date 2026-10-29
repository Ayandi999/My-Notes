"use client";

import { useState } from "react";
import { FileRecord } from "@/functions/fetch-all-files";
import {
  FileText,
  Mic,
  File,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  UploadCloud,
  FolderOpen,
  RotateCw,
  Trash2,
  Loader2,
  X,
} from "lucide-react";
import { UploadModal } from "./upload-modal";

interface FilesSidebarProps {
  initialFiles: FileRecord[];
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatFileDate(
  dateValue: string | Date | number | null | undefined
): string {
  if (!dateValue) return "";
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return "";
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function FilesSidebar({ initialFiles }: FilesSidebarProps) {
  const [filesList, setFilesList] = useState<FileRecord[]>(initialFiles);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    filesList[0]?.id || null
  );
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [syncingFileIds, setSyncingFileIds] = useState<Set<string>>(new Set());
  const [fileToDelete, setFileToDelete] = useState<FileRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    status: "idle" | "uploading" | "success" | "error";
    fileName: string;
    errorMessage?: string;
  }>({ status: "idle", fileName: "" });

  const handleFileUploaded = (newFile: FileRecord) => {
    setFilesList((prev) => [newFile, ...prev]);
    setSelectedFileId(newFile.id);
  };

  const handleStartUpload = async (file: globalThis.File) => {
    setUploadStatus({
      status: "uploading",
      fileName: file.name,
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "File upload failed");
      }

      if (data.record) {
        handleFileUploaded(data.record);
      }

      setUploadStatus({
        status: "success",
        fileName: file.name,
      });

      // Automatically hide success notification after 3.5 seconds
      setTimeout(() => {
        setUploadStatus((current) =>
          current.status === "success"
            ? { status: "idle", fileName: "" }
            : current
        );
      }, 3500);
    } catch (err: any) {
      setUploadStatus({
        status: "error",
        fileName: file.name,
        errorMessage: err?.message || "Failed to upload file",
      });
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/files/${fileId}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete file");
      }

      // Remove from UI state
      setFilesList((prev) => {
        const updated = prev.filter((f) => f.id !== fileId);
        if (selectedFileId === fileId) {
          setSelectedFileId(updated.length > 0 ? updated[0].id : null);
        }
        return updated;
      });

      setFileToDelete(null);
    } catch (err: any) {
      alert(`Delete failed: ${err?.message || err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSyncFile = async (fileId: string) => {
    if (syncingFileIds.has(fileId)) return;

    setSyncingFileIds((prev) => new Set(prev).add(fileId));

    // Optimistically mark as 'syncing'
    setFilesList((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, syncStatus: "syncing" } : f))
    );

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to sync file into Vector DB");
      }

      // Update state with synced file
      setFilesList((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, syncStatus: "synced" } : f
        )
      );
    } catch (err: any) {
      alert(`Sync failed: ${err?.message || err}`);
      setFilesList((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, syncStatus: "not synced" } : f
        )
      );
    } finally {
      setSyncingFileIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
    }
  };

  const getFileIcon = (mimeType: string | null, name: string) => {
    const isAudio =
      mimeType?.startsWith("audio/") ||
      mimeType?.startsWith("video/") ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|webm|mp4|mov|mkv)$/i.test(name);
    const isPdf =
      mimeType === "application/pdf" || /\.pdf$/i.test(name);

    if (isAudio) return <Mic className="w-4 h-4 text-purple-600 dark:text-purple-400" />;
    if (isPdf) return <FileText className="w-4 h-4 text-rose-600 dark:text-rose-400" />;
    return <File className="w-4 h-4 text-blue-600 dark:text-blue-400" />;
  };

  const getSyncStatusBadge = (status: string, isSyncing: boolean) => {
    if (isSyncing || status === "syncing") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 animate-pulse">
          <Clock className="w-3 h-3 animate-spin" />
          <span>Syncing</span>
        </span>
      );
    }

    switch (status) {
      case "synced":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3" />
            <span>Synced</span>
          </span>
        );
      case "not synced":
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-3 h-3" />
            <span>Not Synced</span>
          </span>
        );
    }
  };

  return (
    <>
      <aside className="w-80 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 flex flex-col h-full">
        {/* Top Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-zinc-500" />
            <h2 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              Sources & Files
            </h2>
            <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 font-mono">
              {filesList.length}
            </span>
          </div>

          {/* Add Resource Button */}
          <button
            type="button"
            onClick={() => setIsUploadModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Files List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filesList.length === 0 ? (
            <div
              onClick={() => setIsUploadModalOpen(true)}
              className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-400 cursor-pointer rounded-2xl hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition group"
            >
              <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/50 flex items-center justify-center mb-3 transition">
                <UploadCloud className="w-7 h-7 text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition" />
              </div>
              <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                No files added yet
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-[200px]">
                Click here or &quot;Add&quot; to upload lecture audio, videos, or PDF notes.
              </p>
            </div>
          ) : (
            filesList.map((file) => {
              const isSelected = selectedFileId === file.id;
              const isSyncing = syncingFileIds.has(file.id);

              return (
                <div
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                  className={`group p-3 rounded-xl border transition cursor-pointer flex flex-col gap-2.5 ${
                    isSelected
                      ? "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 shadow-sm"
                      : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/80">
                      {getFileIcon(file.mimeType, file.realName || file.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition">
                        {file.realName || file.name}
                      </p>
                      <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                        {file.size || "Unknown size"} •{" "}
                        <span suppressHydrationWarning>
                          {formatFileDate(file.createdAt)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800/60">
                    <div className="flex items-center gap-1.5">
                      {getSyncStatusBadge(file.syncStatus, isSyncing)}

                      {/* Sync / Reload Button - removed once synced */}
                      {file.syncStatus !== "synced" && (
                        <button
                          type="button"
                          disabled={isSyncing}
                          title="Sync into Qdrant Vector DB"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSyncFile(file.id);
                          }}
                          className="p-1 rounded-md text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-40"
                        >
                          <RotateCw
                            className={`w-3.5 h-3.5 ${
                              isSyncing ? "animate-spin text-blue-600" : ""
                            }`}
                          />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {file.url && (
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          View
                        </a>
                      )}

                      {/* Delete Button */}
                      <button
                        type="button"
                        title="Delete document"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFileToDelete(file);
                        }}
                        className="p-1 rounded-md text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 text-[11px] text-zinc-500 text-center">
          Multimodal Knowledge Base • Ready
        </div>
      </aside>

      {/* Upload Modal (centered with drag-and-drop & native file picker) */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onStartUpload={handleStartUpload}
        onFileUploaded={handleFileUploaded}
      />

      {/* Floating Bottom Upload Toast */}
      {uploadStatus.status !== "idle" && (
        <aside
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200"
        >
          <div
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border backdrop-blur-md max-w-sm ${
              uploadStatus.status === "uploading"
                ? "bg-white/95 dark:bg-zinc-900/95 border-blue-200 dark:border-blue-900 text-zinc-900 dark:text-zinc-100"
                : uploadStatus.status === "success"
                ? "bg-emerald-50/95 dark:bg-emerald-950/95 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100"
                : "bg-rose-50/95 dark:bg-rose-950/95 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
            }`}
          >
            {uploadStatus.status === "uploading" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 flex-shrink-0">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            {uploadStatus.status === "success" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/80 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            )}
            {uploadStatus.status === "error" && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-900/80 text-rose-600 dark:text-rose-400 flex-shrink-0">
                <AlertCircle className="w-4 h-4" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate">
                {uploadStatus.status === "uploading" && "Uploading document..."}
                {uploadStatus.status === "success" && "Upload complete!"}
                {uploadStatus.status === "error" && "Upload failed"}
              </p>
              <p className="text-[11px] opacity-75 truncate">
                {uploadStatus.status === "error"
                  ? uploadStatus.errorMessage || uploadStatus.fileName
                  : uploadStatus.fileName}
              </p>
            </div>

            {uploadStatus.status !== "uploading" && (
              <button
                type="button"
                onClick={() =>
                  setUploadStatus({ status: "idle", fileName: "" })
                }
                title="Dismiss"
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 opacity-60 hover:opacity-100 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </aside>
      )}

      {/* Delete Confirmation Modal */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  Delete Document?
                </h3>
                <p className="text-xs text-zinc-400">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                &ldquo;{fileToDelete.realName || fileToDelete.name}&rdquo;
              </span>
              ?
            </p>

            <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 space-y-1">
              <p className="font-medium text-zinc-700 dark:text-zinc-300">
                The resource will be completely purged from:
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                <li>PostgreSQL Neon Database</li>
                <li>Cloudinary Cloud Storage</li>
                <li>Qdrant Vector DB embeddings</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setFileToDelete(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => handleDeleteFile(fileToDelete.id)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
              >
                {isDeleting ? (
                  <>
                    <Clock className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default FilesSidebar;
