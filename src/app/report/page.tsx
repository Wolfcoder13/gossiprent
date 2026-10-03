import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PropertyAddress } from "@/components/property-address";
import { ButtonLink, EmptyState } from "@/components/ui";
import { getT, type T } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ReportForm } from "./report-form";
import { findReportTarget, REASONS_FOR, type ReportSubject } from "./target";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.report"), robots: { index: false, follow: false } };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Message keys for what a review is about.
const ABOUT_LABEL = {
  landlord: "common.roles.landlord",
  renter: "common.roles.renter",
  property: "common.roles.property",
} as const;

/**
 * /report?target=review|profile|property|account&id=<uuid>. The link must
 * point to something that exists; anything else shows "This can't be reported."
 */
export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const params = await searchParams;
  const [t, user, subject] = await Promise.all([
    getT(),
    getCurrentUser(),
    findReportTarget(first(params.target), first(params.id)),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("report.title")}</h1>
      {subject ? (
        <>
          <p className="mt-2 text-muted">{t("report.intro")}</p>
          <SubjectSummary subject={subject} t={t} />
          <div className="mt-6 rounded-2xl border border-line bg-surface p-6 shadow-sm">
            <ReportForm
              target={subject.target}
              id={subject.id}
              reasons={REASONS_FOR[subject.target]}
              loggedIn={user !== null}
              backHref={subject.href ?? "/"}
            />
          </div>
        </>
      ) : (
        <div className="mt-8">
          <EmptyState title={t("report.invalid.title")} action={<ButtonLink href="/">{t("report.invalid.home")}</ButtonLink>}>
            {t("report.invalid.body")}
          </EmptyState>
        </div>
      )}
    </div>
  );
}

/** "What you're reporting": a label, then the review title, name or address (nominative, after the label). */
function SubjectSummary({ subject, t }: { subject: ReportSubject; t: T }) {
  const rows: { label: string; value: ReactNode }[] = [];
  switch (subject.target) {
    case "review":
      rows.push({ label: t("report.subject.review"), value: t("report.subject.reviewTitle", { title: subject.title }) });
      rows.push({
        label: t(ABOUT_LABEL[subject.about.kind]),
        value:
          subject.about.kind === "property" ? (
            <PropertyAddress
              address={subject.about.address}
              unit={subject.about.unit}
              postalCode={subject.about.postalCode}
            />
          ) : (
            subject.about.name
          ),
      });
      break;
    case "profile":
      rows.push({ label: t("report.subject.profile"), value: subject.name });
      break;
    case "property":
      rows.push({
        label: t("report.subject.property"),
        value: <PropertyAddress address={subject.address} unit={subject.unit} postalCode={subject.postalCode} />,
      });
      break;
    case "account":
      rows.push({ label: t("report.subject.account"), value: t("report.subject.accountBody") });
      break;
  }

  return (
    <section aria-labelledby="report-subject" className="mt-6 rounded-2xl border border-line bg-surface-muted px-5 py-4">
      <h2 id="report-subject" className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t("report.subject.heading")}
      </h2>
      <dl className="mt-2 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="shrink-0 text-sm font-medium text-muted sm:w-24">{row.label}</dt>
            <dd className="min-w-0 wrap-anywhere text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      {subject.href && (
        <Link href={subject.href} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
          {t("report.subject.view")}
        </Link>
      )}
    </section>
  );
}
