import type { Metadata } from "next";
import Link from "next/link";
import { KennitalaLookup } from "@/components/kennitala-lookup";
import { redirectKennitalaQuery } from "@/components/kennitala-query";
import { ReviewList } from "@/components/review-card";
import { SearchBox } from "@/components/search-box";
import { ButtonLink, EmptyState, Notice } from "@/components/ui";
import { getFormat, getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSiteStats, listRecentReviews } from "@/lib/data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: { absolute: t("meta.title") }, description: t("meta.description") };
}

// Message keys for the three "what you can review" cards.
const PATHS = [
  {
    eyebrow: "home.paths.forRenters",
    title: "home.paths.landlord.title",
    body: "home.paths.landlord.body",
    cta: "home.paths.landlord.cta",
    href: "/landlords",
    accent: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  },
  {
    eyebrow: "home.paths.forRenters",
    title: "home.paths.property.title",
    body: "home.paths.property.body",
    cta: "home.paths.property.cta",
    href: "/properties",
    accent: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
  },
  {
    eyebrow: "home.paths.forLandlords",
    title: "home.paths.renter.title",
    body: "home.paths.renter.body",
    cta: "home.paths.renter.cta",
    href: "/renters",
    accent: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
  },
] as const;

const STATS = [
  { key: "reviews", label: "home.stats.reviews" },
  { key: "landlords", label: "home.stats.landlords" },
  { key: "renters", label: "home.stats.renters" },
  { key: "properties", label: "home.stats.properties" },
] as const;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const search = await searchParams;
  // The search box goes to /search, but a hand-made /?q=<kennitala> is never echoed either.
  redirectKennitalaQuery(search.q);
  const [t, format, stats, recent, user] = await Promise.all([
    getT(),
    getFormat(),
    getSiteStats(),
    listRecentReviews(6),
    getCurrentUser(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {search.account === "deleted" && !user && (
        <div className="pt-6">
          <Notice tone="success">{t("home.accountClosed")}</Notice>
        </div>
      )}

      <section className="py-14 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">{t("home.hero.eyebrow")}</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-ink sm:text-6xl">
          {t("home.hero.title")}
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">{t("home.hero.intro")}</p>

        <SearchBox
          action="/search"
          inputId="home-search"
          label={t("home.search.label")}
          placeholder={t("home.search.placeholder")}
          buttonLabel={t("home.search.button")}
          variant="hero"
        />
        <div className="mt-6 max-w-xl">
          <KennitalaLookup loggedIn={user !== null} />
        </div>

        <dl className="mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.key} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">{t(stat.label)}</dt>
              <dd className="text-2xl font-bold tabular-nums text-ink">{format.number(stats[stat.key])}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="paths-heading">
        <h2 id="paths-heading" className="sr-only">
          {t("home.paths.heading")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {PATHS.map((path) => (
            <li key={path.title} className="flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-sm">
              <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${path.accent}`}>
                {t(path.eyebrow)}
              </span>
              <h3 className="mt-3 text-xl font-semibold text-ink">{t(path.title)}</h3>
              <p className="mt-2 flex-1 text-muted">{t(path.body)}</p>
              <Link href={path.href} className="mt-5 font-semibold text-brand hover:underline">
                {t(path.cta)} →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-heading" className="mt-16">
        <h2 id="recent-heading" className="text-2xl font-bold tracking-tight text-ink">
          {t("home.latest.heading")}
        </h2>
        <div className="mt-6">
          {recent.length > 0 ? (
            <ReviewList reviews={recent} viewerId={user?.id} showSubject />
          ) : (
            <EmptyState
              title={t("home.latest.emptyTitle")}
              action={!user && <ButtonLink href="/signup">{t("home.latest.emptyAction")}</ButtonLink>}
            >
              {t("home.latest.emptyBody")}
            </EmptyState>
          )}
        </div>
      </section>

      {!user && (
        <section className="mt-16 rounded-3xl bg-brand px-6 py-10 text-brand-ink sm:px-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("home.cta.title")}</h2>
          <p className="mt-2 max-w-2xl opacity-90">{t("home.cta.body")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/signup?role=renter"
              className="rounded-full bg-surface px-5 py-2.5 font-semibold text-ink hover:bg-surface-muted"
            >
              {t("home.cta.renter")}
            </Link>
            <Link
              href="/signup?role=landlord"
              className="rounded-full border border-current px-5 py-2.5 font-semibold hover:bg-white/10"
            >
              {t("home.cta.landlord")}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
