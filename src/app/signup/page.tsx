import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeRedirectPath } from "@/lib/validation";
import { SignupForm } from "./signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.signup") };
}

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next, role } = await searchParams;
  const returnTo = safeRedirectPath(next, "/dashboard");
  if (await getCurrentUser()) redirect(returnTo);
  const t = await getT();

  return (
    <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("auth.signup.heading")}</h1>
      <p className="mt-2 text-muted">{t("auth.signup.intro")}</p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <SignupForm
          next={returnTo}
          defaultRole={role === "landlord" || role === "renter" ? role : undefined}
        />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        {t("auth.signup.haveAccount")}{" "}
        <Link
          href={returnTo === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-brand hover:underline"
        >
          {t("auth.signup.logIn")}
        </Link>
      </p>
    </div>
  );
}
