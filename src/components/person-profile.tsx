import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { getFormat, getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getPublicUser,
  getRatingSummary,
  getReviewByAuthor,
  listProperties,
  listReviewsAbout,
  type PublicUser,
} from "@/lib/data";
import { profilePath, reportPath } from "@/lib/paths";
import { hasRole, reviewerRole, rolesOf } from "@/lib/roles";
import { CardGrid, PropertyCard } from "./cards";
import { Pagination, redirectIfPastLastPage } from "./pagination";
import { RatingSummary } from "./rating-summary";
import { ReviewList } from "./review-card";
import { ReviewPanel, ReviewsHeading } from "./review-panel";
import { Avatar, buttonStyles, Card, cx, EmptyState, NoAccountBadge, RoleBadge } from "./ui";

const PROPERTIES_SHOWN = 60;

// Message keys, per role (translated inside the request).
const TAB = { landlord: "profile.tabs.landlord", renter: "profile.tabs.renter" } as const;
const RATING_HEADING = { landlord: "profile.ratingHeading.landlord", renter: "profile.ratingHeading.renter" } as const;
const REVIEWS_HEADING = { landlord: "profile.reviews.heading.landlord", renter: "profile.reviews.heading.renter" } as const;
const REVIEWS_INTRO = { landlord: "profile.reviews.intro.landlord", renter: "profile.reviews.intro.renter" } as const;
const REVIEWS_EMPTY = { landlord: "profile.reviews.empty.landlord", renter: "profile.reviews.empty.renter" } as const;
const REVIEWS_EMPTY_SELF = {
  landlord: "profile.reviews.emptySelf.landlord",
  renter: "profile.reviews.emptySelf.renter",
} as const;
const OWNER_NOTE = { landlord: "profile.ownerNote.landlord", renter: "profile.ownerNote.renter" } as const;

/** "Reykjavík · Member since October 2026" or "First reviewed October 2026", and the fine print. */
async function ProfileFacts({ person }: { person: PublicUser }) {
  const [t, format] = await Promise.all([getT(), getFormat()]);
  if (person.hasAccount) {
    const since = person.joinedAt ? format.monthYear(person.joinedAt) : null;
    return (
      <>
        {since && (
          <p className="mt-1 text-sm wrap-anywhere text-muted">
            {person.city
              ? t("profile.cityMemberSince", { city: person.city, date: since })
              : t("profile.memberSince", { date: since })}
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted">{t("profile.identityNotVerified")}</p>
      </>
    );
  }
  return person.firstReviewedAt ? (
    <p className="mt-1 text-sm text-muted">
      {t("profile.firstReviewed", { date: format.monthYear(person.firstReviewedAt) })}
    </p>
  ) : null;
}

/** On a profile without an account: where the page and its name came from, and how to take it over. */
async function NoAccountNote({ person }: { person: PublicUser }) {
  const t = await getT();
  return (
    <p className="mt-4 rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-muted">
      {person.isCompany
        ? t("profile.noAccountNote.company")
        : t.rich("profile.noAccountNote.person", {
            signUp: (
              <Link href="/signup" className="font-semibold text-brand hover:underline">
                {t("profile.signUp")}
              </Link>
            ),
          })}
    </p>
  );
}

/**
 * Public profile page for a person (or company) in one role, with or without
 * an account. Someone who is both a landlord and a renter has two pages
 * (/landlords/:id and /renters/:id), each with its own rating, linked by tabs.
 * Never shows the kennitala.
 */
export async function PersonProfile({
  id,
  role,
  page,
  saved = false,
}: {
  id: string;
  role: UserRole;
  page: number;
  /** ?saved=1: the viewer just posted a review here from /reviews/new. */
  saved?: boolean;
}) {
  const person = await getPublicUser(id);
  if (!person) notFound();
  // e.g. /renters/:id for someone who is only a landlord: go to their page.
  if (!hasRole(person, role)) redirect(profilePath(person));

  const roles = rolesOf(person);
  const otherRole = roles.find((r) => r !== role);
  const [viewer, t, format] = await Promise.all([getCurrentUser(), getT(), getFormat()]);
  const [summary, otherSummary, reviewPage, myReview, managed] = await Promise.all([
    getRatingSummary({ userId: id, as: role }),
    otherRole ? getRatingSummary({ userId: id, as: otherRole }) : null,
    listReviewsAbout({ userId: id, as: role }, page),
    viewer ? getReviewByAuthor(viewer.id, { userId: id, as: role }) : null,
    role === "landlord"
      ? listProperties({ landlordId: id, sort: "name", pageSize: PROPERTIES_SHOWN })
      : null,
  ]);
  const summaries = { [role]: summary, ...(otherRole ? { [otherRole]: otherSummary! } : {}) };
  const path = `/${role}s/${id}`;
  redirectIfPastLastPage({
    page,
    pageCount: reviewPage.pageCount,
    total: reviewPage.total,
    basePath: path,
    hash: "reviews",
  });
  const isSelf = viewer?.id === id;
  // Renters review landlords and landlords review renters.
  const mayReview = !isSelf && (!viewer || hasRole(viewer, reviewerRole(role)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <Card as="section">
            <div className="flex items-start gap-4">
              <Avatar name={person.name} id={person.id} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="min-w-0 text-2xl font-bold tracking-tight wrap-anywhere text-ink sm:text-3xl">
                    {person.name}
                  </h1>
                  {roles.map((r) => (
                    <RoleBadge key={r} role={r} />
                  ))}
                  {!person.hasAccount && <NoAccountBadge />}
                </div>
                <ProfileFacts person={person} />
                {person.bio && (
                  <p className="mt-3 whitespace-pre-line break-words text-ink/85">{person.bio}</p>
                )}
              </div>
            </div>
            {!person.hasAccount && <NoAccountNote person={person} />}
            {otherRole && (
              <nav aria-label={t("profile.tabs.label")} className="mt-6 flex flex-wrap gap-2">
                {roles.map((r) => {
                  const s = summaries[r]!;
                  return (
                    <Link
                      key={r}
                      href={`/${r}s/${id}`}
                      aria-current={r === role ? "page" : undefined}
                      className={cx(
                        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                        r === role
                          ? "border-brand bg-brand-soft text-brand-soft-ink"
                          : "border-line-strong text-muted hover:bg-surface-muted hover:text-ink",
                      )}
                    >
                      {t(TAB[r])}{" "}
                      <span className="text-xs">
                        {s.count > 0 ? (
                          <>
                            ({format.rating(s.average)}
                            <span aria-hidden>★</span>
                            <span className="sr-only">{t("profile.tabs.outOf")}</span>,{" "}
                            {t("common.rating.reviewCount", { count: s.count })})
                          </>
                        ) : (
                          t("profile.tabs.noReviews")
                        )}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            )}
            <div className={cx("border-t border-line pt-6", otherRole ? "mt-4" : "mt-6")}>
              {otherRole && (
                <h2 className="mb-4 text-sm font-semibold text-muted">
                  {t(RATING_HEADING[role], { name: person.name })}
                </h2>
              )}
              <RatingSummary summary={summary} />
            </div>
            {mayReview && (
              // A plain anchor (not next/link) so keyboard focus moves to the form too.
              <a
                href="#your-review"
                className={cx(
                  buttonStyles.base,
                  buttonStyles.primary,
                  "mt-6 w-full rounded-2xl text-center wrap-anywhere lg:hidden",
                )}
              >
                {myReview ? t("profile.editButton") : t("profile.reviewButton", { name: person.name })}
              </a>
            )}
            <p className="mt-4 text-right">
              <Link
                href={reportPath("profile", person.id)}
                rel="nofollow"
                className="text-xs text-muted hover:text-ink hover:underline"
              >
                {t("profile.report")}
              </Link>
            </p>
          </Card>

          {managed && (
            <section aria-labelledby="properties-heading">
              <h2 id="properties-heading" className="mb-4 text-xl font-bold tracking-tight text-ink">
                {t("profile.properties.heading")}{" "}
                <span className="font-normal text-muted">({format.number(managed.total)})</span>
              </h2>
              {managed.items.length > 0 ? (
                <>
                  <CardGrid>
                    {managed.items.map((property) => (
                      <li key={property.id}>
                        <PropertyCard property={property} />
                      </li>
                    ))}
                  </CardGrid>
                  {managed.total > managed.items.length && (
                    <p className="mt-3 text-sm text-muted">
                      {t("profile.properties.showing", { count: managed.total, shown: managed.items.length })}
                    </p>
                  )}
                </>
              ) : (
                <EmptyState title={t("profile.properties.empty")} />
              )}
            </section>
          )}

          <section aria-labelledby="reviews-heading" id="reviews">
            <div className="mb-4">
              <ReviewsHeading
                id="reviews-heading"
                count={reviewPage.total}
                label={otherRole ? t(REVIEWS_HEADING[role]) : undefined}
              />
              <p className="text-sm text-muted">{t(REVIEWS_INTRO[role], { name: person.name })}</p>
            </div>
            {reviewPage.items.length > 0 ? (
              <div className="space-y-4">
                <ReviewList reviews={reviewPage.items} viewerId={viewer?.id} />
                <Pagination page={page} pageCount={reviewPage.pageCount} basePath={path} hash="reviews" />
              </div>
            ) : (
              <EmptyState title={t(REVIEWS_EMPTY[role], { name: person.name })}>
                {isSelf ? t(REVIEWS_EMPTY_SELF[role]) : t("profile.reviews.emptyOther")}
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:p-1">
          <ReviewPanel
            kind={role}
            subjectId={person.id}
            subjectName={person.name}
            viewer={viewer}
            existing={myReview}
            returnTo={path}
            ownerNote={isSelf ? t(OWNER_NOTE[role]) : undefined}
            saved={saved}
          />
        </aside>
      </div>
    </div>
  );
}
