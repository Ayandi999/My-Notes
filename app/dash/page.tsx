import { Suspense } from "react";
import Link from "next/link";
import { UserButton } from "@/components/auth/user-button";
import { BookOpen, Loader2 } from "lucide-react";
import { DashboardContent } from "./dashboard-content";

export const metadata = {
  title: "Dashboard - NotebookLM",
  description: "Personal AI study notebook with multimodal document and audio support",
};

export default function DashboardPage() {
  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-black overflow-hidden font-sans">
      {/* Top Header */}
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 flex items-center justify-between flex-shrink-0 z-20">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
              <BookOpen className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-zinc-900 dark:text-zinc-100">
              NotebookLM
            </span>
          </Link>
          <span className="text-zinc-300 dark:text-zinc-700">/</span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Research Notebook
          </span>
        </div>

        <div className="flex items-center gap-3">
          <UserButton />
        </div>
      </header>

      {/* Main Workspace wrapped in Suspense for Next.js Cache Components / PPR */}
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-zinc-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span className="text-sm font-medium">Loading your notebook...</span>
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </div>
  );
}
