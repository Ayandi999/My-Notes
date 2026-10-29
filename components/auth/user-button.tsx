"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { LogOut, Loader2 } from "lucide-react";

export function UserButton() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [imageError, setImageError] = useState(false);

  if (isPending) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-zinc-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <Link
        href="/sign-in"
        className="px-4 py-2 rounded-xl text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition shadow-sm"
      >
        Sign in
      </Link>
    );
  }

  const { user } = session;
  const initial = user.name?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase() || "U";

  const handleSignOut = async () => {
    await signOut();
    router.refresh();
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2.5">
        {user.image && !imageError ? (
          <Image
            src={user.image}
            alt={user.name || "User avatar"}
            width={32}
            height={32}
            onError={() => setImageError(true)}
            className="w-8 h-8 rounded-full border border-zinc-200 dark:border-zinc-700 object-cover"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
            {initial}
          </div>
        )}
        <div className="hidden sm:flex flex-col text-left">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 leading-tight">
            {user.name || "User"}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[140px]">
            {user.email}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        title="Sign out"
        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}

export default UserButton;
