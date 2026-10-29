import { SignInCard } from "@/components/auth/sign-in";

export const metadata = {
  title: "Sign In - NotebookLM Clone",
  description: "Sign in to your account with Google, GitHub, or Email",
};

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
      <SignInCard callbackURL="/dash" />
    </div>
  );
}
