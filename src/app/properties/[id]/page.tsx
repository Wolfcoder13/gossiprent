import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination, redirectIfPastLastPage } from "@/components/pagination";
import { RatingSummary } from "@/components/rating-summary";
import { ReviewList } from "@/components/review-card";
import { ReviewPanel, ReviewsHeading } from "@/components/review-panel";
import { Avatar, buttonStyles, Card, cx, EmptyState, RoleBadge } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getProperty,
  getRatingSummary,
  getReviewByAuthor,
  listReviewsAbout,
  parsePage,
  propertyLabel,
} from "@/lib/data";
import { formatMonthYear } from "@/lib/format";
import { LandlordActions } from "./landlord-actions";

export async function generateMetadata({ params }: PageProps<"/properties/[id]">): Promise<Metadata> {
  const property = await getProperty((await params).id);
  if (!property) return { title: "Property not found" };
  const label = `${propertyLabel(property)}, ${property.city}`;
  return { title: `${label} — reviews`, description: `Renter reviews of ${label}, ${property.region}.` };
}

export default async function PropertyPage({ params, searchParams }: PageProps<"/properties/[id]">) {
  const [{ id }, { page: pageParam }] = await Promise.all([params, searchParams]);
  const property = await getProperty(id);
  if (!property) notFound();

  const page = parsePage(pageParam);
  const viewer = await getCurrentUser();
  const [summary, reviewPage, myReview] = await Promise.all([
    getRatingSummary({ propertyId: id }),
    listReviewsAbout({ propertyId: id }, page),
    viewer ? getReviewByAuthor(viewer.id, { propertyId: id }) : null,
  ]);
  const label = propertyLabel(property);
  const path = `/properties/${id}`;
  redirectIfPastLastPage({
    page,
    pageCount: reviewPage.pageCount,
    total: reviewPage.total,
    basePath: path,
    hash: "reviews",
  });
  const isOwner = Boolean(viewer && property.landlord?.id === viewer.id);
  const canClaim = viewer?.role === "landlord" && !property.landlord;
  const mayReview = !isOwner && (!viewer || viewer.role === "renter");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <Card as="section">
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge role="property" />
              <span className="text-xs text-muted">Listed {formatMonthYear(property.createdAt)}</span>
            </div>
            <h1 className="mt-2 wrap-anywhere text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {label}
            </h1>
            <p className="mt-1 wrap-anywhere text-muted">
              {property.city}, {property.region}
              {property.postalCode ? ` ${property.postalCode}` : ""}
            </p>
            {property.description && (
              <p className="mt-3 break-words text-ink/85">{property.description}</p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-surface-muted px-4 py-3">
              {property.landlord ? (
                <>
                  <Avatar name={property.landlord.name} id={property.landlord.id} size="sm" />
                  <p className="min-w-0 grow basis-40 text-sm text-muted">
                    Landlord:{" "}
                    <Link
                      href={`/landlords/${property.landlord.id}`}
                      className="font-semibold wrap-anywhere text-ink hover:underline"
                    >
                      {property.landlord.name}
                    </Link>
                  </p>
                </>
              ) : (
                <p className="min-w-0 grow basis-40 text-sm text-muted">
                  The landlord for this property isn&apos;t on GossipRent yet.
                </p>
              )}
              {viewer?.role === "landlord" && (
                <LandlordActions
                  propertyId={property.id}
                  mode={isOwner ? "unlink" : canClaim ? "claim" : null}
                />
              )}
            </div>

            <div className="mt-6 border-t border-line pt-6">
              <RatingSummary summary={summary} />
            </div>
            {mayReview && (
              // A plain anchor (not next/link) so keyboard focus moves to the form too.
              <a
                href="#your-review"
                className={cx(buttonStyles.base, buttonStyles.primary, "mt-6 w-full lg:hidden")}
              >
                {myReview ? "Edit your review" : "Review this property"}
              </a>
            )}
          </Card>

          <section aria-labelledby="reviews-heading" id="reviews" className="scroll-mt-36 sm:scroll-mt-24">
            <div className="mb-4">
              <ReviewsHeading id="reviews-heading" count={reviewPage.total} />
              <p className="text-sm text-muted">What renters say about living here.</p>
            </div>
            {reviewPage.items.length > 0 ? (
              <div className="space-y-4">
                <ReviewList reviews={reviewPage.items} viewerId={viewer?.id} />
                <Pagination page={page} pageCount={reviewPage.pageCount} basePath={path} hash="reviews" />
              </div>
            ) : (
              <EmptyState title="No reviews for this property yet">
                Live here, or used to? Be the first to share what it&apos;s like.
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:p-1">
          <ReviewPanel
            kind="property"
            subjectId={property.id}
            subjectName={label}
            viewer={viewer}
            existing={myReview}
            returnTo={path}
            ownerNote={
              isOwner
                ? "You're the landlord for this property. Reviews from your renters appear here."
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
