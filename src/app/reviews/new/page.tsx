import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { getT } from "@/i18n/server";
import { requireUser } from "@/lib/auth/current-user";
import { hasRole, reviewerRole } from "@/lib/roles";
import { ReviewWizard } from "./review-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.newReview"), robots: { index: false, follow: false } };
}

const PERSON_KINDS = ["landlord", "renter"] as const;

// Message keys for the first step's choices.
const CHOICE = { landlord: "reviews.wizard.choose.landlord", renter: "reviews.wizard.choose.renter" } as const;
const CHOICE_HINT = {
  landlord: "reviews.wizard.choose.landlordHint",
  renter: "reviews.wizard.choose.renterHint",
} as const;

/**
 * Write a review of a landlord or renter by kennitala: choose who (?kind=),
 * enter their kennitala, see who it belongs to, then write the review.
 * Property reviews are written on the property's page.
 */
export default async function NewReviewPage({ searchParams }: PageProps<"/reviews/new">) {
  const { kind: wanted } = await searchParams;
  const requested = PERSON_KINDS.find((kind) => kind === wanted);
  const user = await requireUser(requested ? `/reviews/new?kind=${requested}` : "/reviews/new");
  const t = await getT();

  // Renters review landlords (and properties); landlords review renters.
  const kinds = PERSON_KINDS.filter((kind) => hasRole(user, reviewerRole(kind)));
  const reviewsProperties = hasRole(user, "renter");
  // Someone who can only review renters has nothing to choose.
  const only = kinds.length === 1 && !reviewsProperties ? kinds[0] : undefined;
  const kind = requested && kinds.includes(requested) ? requested : only;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-ink">{t("reviews.wizard.title")}</h1>
      <p className="mt-2 text-muted">{t("reviews.wizard.intro")}</p>

      {kind ? (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <ReviewWizard key={kind} kind={kind} backHref={only ? null : "/reviews/new"} />
        </div>
      ) : (
        <section aria-labelledby="choose-heading" className="mt-8">
          <h2 id="choose-heading" className="text-lg font-semibold text-ink">
            {t("reviews.wizard.choose.legend")}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {kinds.map((choice) => (
              <li key={choice}>
                <Link
                  href={`/reviews/new?kind=${choice}`}
                  aria-describedby={`choice-${choice}-hint`}
                  className="block h-full rounded-2xl border border-line bg-surface p-5 shadow-sm transition-colors hover:border-brand hover:bg-brand-soft"
                >
                  <span className="block font-semibold text-ink">{t(CHOICE[choice])}</span>
                  <span id={`choice-${choice}-hint`} className="mt-1 block text-sm text-muted">
                    {t(CHOICE_HINT[choice])}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {reviewsProperties && (
            <div className="mt-6 rounded-2xl border border-dashed border-line-strong p-5">
              <p className="text-sm text-muted">{t("reviews.wizard.property")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ButtonLink href="/properties" variant="secondary">
                  {t("reviews.wizard.findProperty")}
                </ButtonLink>
                <ButtonLink href="/properties/new" variant="secondary">
                  {t("reviews.wizard.addProperty")}
                </ButtonLink>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
