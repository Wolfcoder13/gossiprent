import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getPublicUser,
  getRatingSummary,
  getReviewByAuthor,
  listProperties,
  listReviewsAbout,
} from "@/lib/data";
import { formatMonthYear, plural } from "@/lib/format";
import { profilePath } from "@/lib/paths";
import { hasRole, reviewerRole, rolesOf } from "@/lib/roles";
import { CardGrid, PropertyCard } from "./cards";
import { Pagination, redirectIfPastLastPage } from "./pagination";
import { RatingSummary } from "./rating-summary";
import { ReviewList } from "./review-card";
import { ReviewPanel, ReviewsHeading } from "./review-panel";
import { formatRating } from "./stars";
import { Avatar, buttonStyles, Card, cx, EmptyState, RoleBadge } from "./ui";

const PROPERTIES_SHOWN = 60;

const ROLE_TAB_LABEL: Record<UserRole, string> = {
  landlord: "As a landlord",
  renter: "As a renter",
};

/**
 * Public profile page for a person in one role. Someone who is both a
 * landlord and a renter has two pages (/landlords/:id and /renters/:id), each
 * with its own rating, linked by tabs.
 */
export async function PersonProfile({
  id,
  role,
  page,
}: {
  id: string;
  role: UserRole;
  page: number;
}) {
  const person = await getPublicUser(id);
  if (!person) notFound();
  // e.g. /renters/:id for someone who is only a landlord: go to their page.
  if (!hasRole(person, role)) redirect(profilePath(person));

  const roles = rolesOf(person);
  const otherRole = roles.find((r) => r !== role);
  const viewer = await getCurrentUser();
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
  const reviewerNoun = `${reviewerRole(role)}s`;
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
                  {person.deletedAt && (
                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted">
                      Account closed
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm wrap-anywhere text-muted">
                  {person.city ? `${person.city} · ` : ""}Member since {formatMonthYear(person.createdAt)}
                </p>
                {person.bio && (
                  <p className="mt-3 whitespace-pre-line break-words text-ink/85">{person.bio}</p>
                )}
                {person.deletedAt && (
                  <p className="mt-3 text-sm text-muted">
                    {person.name} closed their account
                    {summary.count > 0 ? ". Reviews written about them are still shown." : "."}
                  </p>
                )}
              </div>
            </div>
            {otherRole && (
              <nav aria-label="Ratings by role" className="mt-6 flex flex-wrap gap-2">
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
                      {ROLE_TAB_LABEL[r]}{" "}
                      <span className="text-xs">
                        {s.count > 0 ? (
                          <>
                            ({formatRating(s.average)}
                            <span aria-hidden>★</span>
                            <span className="sr-only"> stars</span>, {plural(s.count, "review")})
                          </>
                        ) : (
                          "(no reviews)"
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
                  {person.name}&apos;s rating {ROLE_TAB_LABEL[role].toLowerCase()}
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
                {myReview ? "Edit your review" : `Review ${person.name}`}
              </a>
            )}
          </Card>

          {managed && (
            <section aria-labelledby="properties-heading">
              <h2 id="properties-heading" className="mb-4 text-xl font-bold tracking-tight text-ink">
                Properties <span className="font-normal text-muted">({managed.total})</span>
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
                      Showing {managed.items.length} of {managed.total} properties.
                    </p>
                  )}
                </>
              ) : (
                <EmptyState title="No properties listed yet" />
              )}
            </section>
          )}

          <section aria-labelledby="reviews-heading" id="reviews">
            <div className="mb-4">
              <ReviewsHeading
                id="reviews-heading"
                count={reviewPage.total}
                label={otherRole ? `Reviews as a ${role}` : undefined}
              />
              <p className="text-sm text-muted">What {reviewerNoun} say about {person.name}.</p>
            </div>
            {reviewPage.items.length > 0 ? (
              <div className="space-y-4">
                <ReviewList reviews={reviewPage.items} viewerId={viewer?.id} />
                <Pagination page={page} pageCount={reviewPage.pageCount} basePath={path} hash="reviews" />
              </div>
            ) : (
              <EmptyState title={`No reviews for ${person.name} yet`}>
                {isSelf
                  ? `When ${reviewerNoun} review you, their reviews will show up here.`
                  : `Be the first to share your experience.`}
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
            ownerNote={
              isSelf
                ? `This is your public profile. Reviews from ${reviewerNoun} appear here — you can't review yourself.`
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
