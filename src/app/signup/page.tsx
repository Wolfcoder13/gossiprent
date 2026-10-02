import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeRedirectPath } from "@/lib/validation";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, role } = await searchParams;
  const returnTo = safeRedirectPath(next, "/dashboard");
  if (await getCurrentUser()) redirect(returnTo);

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Create your account</h1>
      <p className="mt-2 text-muted">
        Free, and it only takes a minute. Your email is never shown publicly.
      </p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <SignupForm
          next={returnTo}
          defaultRole={role === "landlord" || role === "renter" ? role : undefined}
        />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={returnTo === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-brand hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}
