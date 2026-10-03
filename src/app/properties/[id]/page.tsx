import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination, redirectIfPastLastPage } from "@/components/pagination";
import { RatingSummary } from "@/components/rating-summary";
import { ReviewList } from "@/components/review-card";
import { ReviewPanel, ReviewsHeading } from "@/components/review-panel";
import { Avatar, buttonStyles, Card, cx, EmptyState, RoleBadge } from "@/components/ui";
import { addressText, placeLine, streetLine } from "@/i18n/address";
import { getFormat, getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getProperty, getRatingSummary, getReviewByAuthor, listReviewsAbout, parsePage } from "@/lib/data";
import { reportPath } from "@/lib/paths";
import { LandlordActions, RelinkLandlord } from "./landlord-actions";

export async function generateMetadata({ params }: PageProps<"/properties/[id]">): Promise<Metadata> {
  const [property, t] = await Promise.all([getProperty((await params).id), getT()]);
  if (!property) return { title: t("meta.property.notFound") };
  const address = addressText(t, property);
  return {
    title: t("meta.property.title", { address }),
    description: t("meta.property.description", { address }),
  };
}

export default async function PropertyPage({ params, searchParams }: PageProps<"/properties/[id]">) {
  const [{ id }, { page: pageParam }] = await Promise.all([params, searchParams]);
  const property = await getProperty(id);
  if (!property) notFound();

  const page = parsePage(pageParam);
  const viewer = await getCurrentUser();
  const [summary, reviewPage, myReview, t, format] = await Promise.all([
    getRatingSummary({ propertyId: id }),
    listReviewsAbout({ propertyId: id }, page),
    viewer ? getReviewByAuthor(viewer.id, { propertyId: id }) : null,
    getT(),
    getFormat(),
  ]);
  const street = streetLine(t, property);
  const path = `/properties/${id}`;
  redirectIfPastLastPage({
    page,
    pageCount: reviewPage.pageCount,
    total: reviewPage.total,
    basePath: path,
    hash: "reviews",
  });
  const landlord = property.landlord;
  const isOwner = Boolean(viewer && landlord?.id === viewer.id);
  // Landlords can't review their own properties, so someone who reviewed this
  // one can't claim it either.
  const canClaim = !landlord && !myReview;
  const mayReview = !isOwner && (!viewer || viewer.isRenter);
  // The person who added it can change its landlord while that landlord has no account.
  const isCreator = Boolean(viewer && property.createdById === viewer.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <Card as="section">
            <div className="flex flex-wrap items-center gap-2">
              <RoleBadge role="property" />
              <span className="text-xs text-muted">
                {t("properties.page.listed", { date: format.monthYear(property.createdAt) })}
              </span>
            </div>
            <h1 className="mt-2 wrap-anywhere text-2xl font-bold tracking-tight text-ink sm:text-3xl">{street}</h1>
            <p className="mt-1 wrap-anywhere text-muted">{placeLine(property.postalCode)}</p>
            {property.description && <p className="mt-3 break-words text-ink/85">{property.description}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-surface-muted px-4 py-3">
              {landlord ? (
                <>
                  <Avatar name={landlord.name} id={landlord.id} size="sm" />
                  <div className="min-w-0 grow basis-40">
                    <p className="text-sm text-muted">
                      {t.rich("properties.page.landlord", {
                        name: (
                          <Link
                            href={`/landlords/${landlord.id}`}
                            className="font-semibold wrap-anywhere text-ink hover:underline"
                          >
                            {landlord.name}
                          </Link>
                        ),
                      })}
                    </p>
                    {!landlord.hasAccount && (
                      <p className="text-xs text-muted">{t("properties.page.unconfirmed")}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="min-w-0 grow basis-40 text-sm text-muted">{t("properties.page.noLandlord")}</p>
              )}
              {viewer?.isLandlord && (
                <LandlordActions propertyId={property.id} mode={isOwner ? "unlink" : canClaim ? "claim" : null} />
              )}
              {isCreator && (
                <RelinkLandlord
                  propertyId={property.id}
                  hasLandlord={Boolean(landlord)}
                  editable={!landlord?.hasAccount}
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
                {myReview ? t("properties.page.editReview") : t("properties.page.reviewThis")}
              </a>
            )}
            <p className="mt-6 text-right text-xs">
              <Link href={reportPath("property", property.id)} className="text-muted hover:text-ink hover:underline">
                {t("properties.page.report")}
              </Link>
            </p>
          </Card>

          <section aria-labelledby="reviews-heading" id="reviews">
            <div className="mb-4">
              <ReviewsHeading id="reviews-heading" count={reviewPage.total} />
              <p className="text-sm text-muted">{t("properties.page.reviewsIntro")}</p>
            </div>
            {reviewPage.items.length > 0 ? (
              <div className="space-y-4">
                <ReviewList reviews={reviewPage.items} viewerId={viewer?.id} />
                <Pagination page={page} pageCount={reviewPage.pageCount} basePath={path} hash="reviews" />
              </div>
            ) : (
              <EmptyState title={t("properties.page.noReviewsTitle")}>{t("properties.page.noReviewsBody")}</EmptyState>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:-m-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:p-1">
          <ReviewPanel
            kind="property"
            subjectId={property.id}
            subjectName={street}
            viewer={viewer}
            existing={myReview}
            returnTo={path}
            ownerNote={isOwner ? t("properties.page.ownerNote") : undefined}
          />
        </aside>
      </div>
    </div>
  );
}
