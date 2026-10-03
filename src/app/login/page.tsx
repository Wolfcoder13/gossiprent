import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeRedirectPath } from "@/lib/validation";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.login") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(next, "/dashboard");
  if (await getCurrentUser()) redirect(returnTo);
  const t = await getT();

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("auth.login.heading")}</h1>
      <p className="mt-2 text-muted">{t("auth.login.intro")}</p>
      <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <LoginForm next={returnTo} />
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        {t("auth.login.newHere")}{" "}
        <Link
          href={returnTo === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-brand hover:underline"
        >
          {t("auth.login.signUp")}
        </Link>
      </p>
    </div>
  );
}
