/** Shown instead of the site when it's deployed without a database. */
export function SetupRequired() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">Almost there</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Connect a database</h1>
        <p className="mt-3 text-muted">
          GossipRent is deployed, but it needs a Postgres database to store accounts and
          reviews. It takes about a minute:
        </p>
        <ol className="mt-6 list-decimal space-y-3 pl-5 text-ink">
          <li>
            Open this project in the Vercel dashboard and go to the <strong>Storage</strong> tab.
          </li>
          <li>
            Choose <strong>Create Database</strong>, pick <strong>Neon (Serverless Postgres)</strong>,
            and connect it to this project. This sets <code className="rounded bg-surface-muted px-1">DATABASE_URL</code>{" "}
            for you.
          </li>
          <li>
            <strong>Redeploy</strong>. The tables are created automatically during the build.
          </li>
        </ol>
        <p className="mt-6 text-sm text-muted">
          Any Postgres database works — just set <code className="rounded bg-surface-muted px-1">DATABASE_URL</code>{" "}
          in your project&apos;s environment variables.
        </p>
      </div>
    </div>
  );
}
