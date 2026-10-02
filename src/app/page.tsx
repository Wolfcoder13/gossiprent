import Link from "next/link";
import { ReviewList } from "@/components/review-card";
import { ButtonLink, EmptyState, Notice } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSiteStats, listRecentReviews } from "@/lib/data";

const PATHS = [
  {
    eyebrow: "For renters",
    title: "Review your landlord",
    body: "Were repairs quick? Was the deposit returned? Help the next tenant know what they're signing up for.",
    href: "/landlords",
    cta: "Find a landlord",
    accent: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  },
  {
    eyebrow: "For renters",
    title: "Review the place you rent",
    body: "Noise, light, heating, pests, neighbors — share what living there is really like.",
    href: "/properties",
    cta: "Find a property",
    accent: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
  },
  {
    eyebrow: "For landlords",
    title: "Review your renters",
    body: "On-time rent, respectful neighbors, a well-kept home — recognize great tenants and flag problems.",
    href: "/renters",
    cta: "Find a renter",
    accent: "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200",
  },
];

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const [{ account }, stats, recent, user] = await Promise.all([
    searchParams,
    getSiteStats(),
    listRecentReviews(6),
    getCurrentUser(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {account === "deleted" && (
        <div className="pt-6">
          <Notice tone="success">Your account is closed and the reviews you wrote have been deleted.</Notice>
        </div>
      )}

      <section className="py-14 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">
          Landlord &amp; renter reviews
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight text-ink sm:text-6xl">
          Rent with your eyes open.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          Renters review their landlords and the places they live. Landlords review their
          renters. Star ratings plus honest, written reviews — so everyone knows who
          they&apos;re dealing with.
        </p>

        <form action="/search" role="search" className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
          <label htmlFor="home-search" className="sr-only">
            Search landlords, renters, and properties
          </label>
          <input
            id="home-search"
            name="q"
            type="search"
            placeholder="Search a name, city, or address"
            className="flex-1 rounded-full border border-line-input bg-surface px-5 py-3 text-ink shadow-sm placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-focus/40"
          />
          <button
            type="submit"
            className="rounded-full bg-brand px-6 py-3 font-semibold text-brand-ink hover:bg-brand-hover"
          >
            Search
          </button>
        </form>

        <dl className="mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Reviews", value: stats.reviews },
            { label: "Landlords", value: stats.landlords },
            { label: "Renters", value: stats.renters },
            { label: "Properties", value: stats.properties },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">{stat.label}</dt>
              <dd className="text-2xl font-bold tabular-nums text-ink">{stat.value.toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="paths-heading">
        <h2 id="paths-heading" className="sr-only">
          What you can review
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {PATHS.map((path) => (
            <li key={path.title} className="flex flex-col rounded-2xl border border-line bg-surface p-6 shadow-sm">
              <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${path.accent}`}>
                {path.eyebrow}
              </span>
              <h3 className="mt-3 text-xl font-semibold text-ink">{path.title}</h3>
              <p className="mt-2 flex-1 text-muted">{path.body}</p>
              <Link href={path.href} className="mt-5 font-semibold text-brand hover:underline">
                {path.cta} →
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-heading" className="mt-16">
        <div className="flex items-end justify-between gap-4">
          <h2 id="recent-heading" className="text-2xl font-bold tracking-tight text-ink">
            Latest reviews
          </h2>
        </div>
        <div className="mt-6">
          {recent.length > 0 ? (
            <ReviewList reviews={recent} viewerId={user?.id} showSubject />
          ) : (
            <EmptyState
              title="No reviews yet"
              action={!user && <ButtonLink href="/signup">Be the first — sign up</ButtonLink>}
            >
              Once people start reviewing landlords, renters, and properties, the newest reviews
              will show up here.
            </EmptyState>
          )}
        </div>
      </section>

      {!user && (
        <section className="mt-16 rounded-3xl bg-brand px-6 py-10 text-brand-ink sm:px-10">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Had a landlord or tenant worth talking about?</h2>
          <p className="mt-2 max-w-2xl opacity-90">
            Create a free account as a renter or a landlord and leave your first review in a couple of minutes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/signup?role=renter"
              className="rounded-full bg-surface px-5 py-2.5 font-semibold text-ink hover:bg-surface-muted"
            >
              I&apos;m a renter
            </Link>
            <Link
              href="/signup?role=landlord"
              className="rounded-full border border-current px-5 py-2.5 font-semibold hover:bg-white/10"
            >
              I&apos;m a landlord
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
