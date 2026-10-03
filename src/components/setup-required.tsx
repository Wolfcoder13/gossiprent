import { getT } from "@/i18n/server";

const code = (text: string) => <code className="rounded bg-surface-muted px-1">{text}</code>;

/** Shown instead of the site when it's deployed without a database. */
export async function SetupRequired() {
  const t = await getT();
  // Product and setting names stay as Vercel shows them.
  const env = code("DATABASE_URL");
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">{t("errors.setup.eyebrow")}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">{t("errors.setup.title")}</h1>
        <p className="mt-3 text-muted">{t("errors.setup.intro")}</p>
        <ol className="mt-6 list-decimal space-y-3 pl-5 text-ink">
          <li>{t.rich("errors.setup.storage", { storage: <strong>Storage</strong> })}</li>
          <li>
            {t.rich("errors.setup.create", {
              create: <strong>Create Database</strong>,
              neon: <strong>Neon (Serverless Postgres)</strong>,
              env,
            })}
          </li>
          <li>{t.rich("errors.setup.redeploy", { redeploy: <strong>Redeploy</strong> })}</li>
        </ol>
        <p className="mt-6 text-sm text-muted">{t.rich("errors.setup.anyPostgres", { env })}</p>
      </div>
    </div>
  );
}
