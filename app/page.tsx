import Link from "next/link";
import { UserButton } from "@/components/auth/user-button";
import { BookOpen, FileText, Mic, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-black font-sans text-zinc-900 dark:text-zinc-100">
      {/* Top Navigation */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="font-bold text-lg tracking-tight">NotebookLM</span>
          </div>

          <div className="flex items-center gap-4">
            <UserButton />
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-medium mb-6 border border-blue-200 dark:border-blue-900">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Multimodal AI Research & Study Assistant</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight max-w-2xl leading-[1.1]">
          Your personalized AI notebook for{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
            audio & documents
          </span>
        </h1>

        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400 max-w-xl">
          Upload PDF lecture notes, textbooks, and audio recordings. Get instant summaries,
          interactive Q&A, and sample-accurate audio playback with citations.
        </p>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-12 w-full max-w-xl text-left">
          <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-3">
              <Mic className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-base mb-1">Audio & Lecture Video</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Sarvam AI STT transcription, WebVTT subtitle tracks, and sample-accurate timestamp playback.
            </p>
          </div>

          <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="font-semibold text-base mb-1">PDF & Document RAG</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              LangChain PDF parsing, recursive text chunking, and semantic vector indexing in Qdrant.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <Link
            href="/sign-in"
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition shadow-sm"
          >
            Get Started Free
          </Link>
          <Link
            href="/sign-up"
            className="px-6 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium text-sm transition"
          >
            Create Account
          </Link>
        </div>
      </main>
    </div>
  );
}
