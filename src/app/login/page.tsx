import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeRedirectPath } from "@/lib/validation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(next, "/dashboard");
  if (await getCurrentUser()) redirect(returnTo);

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-2 text-muted">Log in to write and manage your reviews.</p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <LoginForm next={returnTo} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        New to GossipRent?{" "}
        <Link
          href={returnTo === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-brand hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
