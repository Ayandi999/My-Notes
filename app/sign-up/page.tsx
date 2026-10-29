import { SignUpCard } from "@/components/auth/sign-up";

export const metadata = {
  title: "Sign Up - NotebookLM Clone",
  description: "Create an account with Google, GitHub, or Email",
};

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black p-4">
      <SignUpCard callbackURL="/" />
    </div>
  );
}
