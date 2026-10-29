"use client";

import { SignInCard } from "./sign-in";

export function SignUpCard({ callbackURL = "/" }: { callbackURL?: string }) {
  return <SignInCard callbackURL={callbackURL} />;
}

export default SignUpCard;
