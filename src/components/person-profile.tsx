import { notFound } from "next/navigation";
import type { UserRole } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getPublicUser,
  getRatingSummary,
  getReviewByAuthor,
  listProperties,
  listReviewsAbout,
} from "@/lib/data";
import { formatMonthYear } from "@/lib/format";
import { CardGrid, PropertyCard } from "./cards";
import { Pagination, redirectIfPastLastPage } from "./pagination";
import { RatingSummary } from "./rating-summary";
import { ReviewList } from "./review-card";
import { ReviewPanel, ReviewsHeading } from "./review-panel";
import { Avatar, ButtonLink, Card, EmptyState, RoleBadge } from "./ui";

const PROPERTIES_SHOWN = 60;

/** Public profile page for a landlord or a renter. */
export async function PersonProfile({
  id,
  role,
  page,
}: {
  id: string;
  role: UserRole;
  page: number;
}) {
  const person = await getPublicUser(id, role);
  if (!person) notFound();

  const viewer = await getCurrentUser();
  const [summary, reviewPage, myReview, managed] = await Promise.all([
    getRatingSummary({ userId: id }),
    listReviewsAbout({ userId: id }, page),
    viewer ? getReviewByAuthor(viewer.id, { userId: id }) : null,
    role === "landlord"
      ? listProperties({ landlordId: id, sort: "name", pageSize: PROPERTIES_SHOWN })
      : null,
  ]);
  const path = `/${role}s/${id}`;
  redirectIfPastLastPage({
    page,
    pageCount: reviewPage.pageCount,
    total: reviewPage.total,
    basePath: path,
    hash: "reviews",
  });
  const isSelf = viewer?.id === id;
  const reviewerNoun = role === "landlord" ? "renters" : "landlords";
  // Renters review landlords and landlords review renters.
  const mayReview = !isSelf && (!viewer || viewer.role !== role);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <Card as="section">
            <div className="flex items-start gap-4">
              <Avatar name={person.name} id={person.id} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="break-words text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                    {person.name}
                  </h1>
                  <RoleBadge role={person.role} />
                  {person.deletedAt && (
                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-muted">
                      Account closed
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {person.city ? `${person.city} · ` : ""}Member since {formatMonthYear(person.createdAt)}
                </p>
                {person.bio && (
                  <p className="mt-3 whitespace-pre-line break-words text-ink/85">{person.bio}</p>
                )}
                {person.deletedAt && (
                  <p className="mt-3 text-sm text-muted">
                    {person.name} closed their account. Reviews written about them are still shown.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 border-t border-line pt-6">
              <RatingSummary summary={summary} />
            </div>
            {mayReview && (
              <ButtonLink href="#your-review" className="mt-6 w-full lg:hidden">
                {myReview ? "Edit your review" : `Review ${person.name}`}
              </ButtonLink>
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

          <section aria-labelledby="reviews-heading" id="reviews" className="scroll-mt-24">
            <div className="mb-4">
              <ReviewsHeading id="reviews-heading" count={reviewPage.total} />
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
