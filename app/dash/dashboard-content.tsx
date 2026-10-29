import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { fetchAllFiles } from "@/functions/fetch-all-files";
import { FilesSidebar } from "@/components/dashboard/files-sidebar";
import { ChatWindow } from "@/components/dashboard/chat-window";

export async function DashboardContent() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/sign-in");
  }

  const userFiles = await fetchAllFiles(session.user.id);

  return (
    <div className="flex-1 flex overflow-hidden">
      <FilesSidebar initialFiles={userFiles} />
      <ChatWindow />
    </div>
  );
}

export default DashboardContent;
