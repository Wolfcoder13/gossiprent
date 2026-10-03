import type { Metadata } from "next";
import Link from "next/link";
import { CardGrid, PropertyCard } from "@/components/cards";
import { RatingSummary } from "@/components/rating-summary";
import { ReviewList } from "@/components/review-card";
import { ButtonLink, Card, EmptyState, PageHeader, RoleBadge } from "@/components/ui";
import { getDb } from "@/db";
import type { UserRole } from "@/db/schema";
import type { Format } from "@/i18n/format";
import { getFormat, getT, type T } from "@/i18n/server";
import { requireUser } from "@/lib/auth/current-user";
import {
  getRatingSummary,
  listProperties,
  listReviewsAbout,
  listReviewsByAuthor,
  listReviewsOfLandlordProperties,
} from "@/lib/data";
import { formatKennitala } from "@/lib/kennitala";
import { profilePath, reportPath } from "@/lib/paths";
import { getOwnKennitala, isNameLocked } from "@/lib/people";
import { rolesOf } from "@/lib/roles";
import { safeRedirectPath } from "@/lib/validation";
import { DeleteAccount } from "./delete-account";
import { PasswordForm, SignOutOthersForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { RolesForm } from "./roles-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.pages.dashboard") };
}

const ABOUT_ME_SHOWN = 20;
const PROPERTY_REVIEWS_SHOWN = 20;
const WRITTEN_SHOWN = 50;
const PROPERTIES_SHOWN = 60;

// Message keys (whole sentences per role).
const ABOUT_ME_HEADING = {
  landlord: "account.aboutYou.asLandlord",
  renter: "account.aboutYou.asRenter",
} as const satisfies Record<UserRole, string>;

const ABOUT_ME_EMPTY = {
  landlord: { title: "account.aboutYou.emptyLandlord.title", body: "account.aboutYou.emptyLandlord.body" },
  renter: { title: "account.aboutYou.emptyRenter.title", body: "account.aboutYou.emptyRenter.body" },
} as const satisfies Record<UserRole, { title: string; body: string }>;

function ShowingNote({
  t,
  shown,
  total,
  href,
  label,
}: {
  t: T;
  shown: number;
  total: number;
  href?: string;
  label?: string;
}) {
  if (total <= shown) return null;
  return (
    <p className="text-sm text-muted">
      {t("account.dashboard.showing", { shown, total })}{" "}
      {href && (
        <Link href={href} className="font-semibold text-brand hover:underline">
          {label}
        </Link>
      )}
    </p>
  );
}

/** "(3)" after a section heading. */
function Count({ value, format }: { value: number; format: Format }) {
  return <span className="font-normal text-muted">({format.number(value)})</span>;
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const [t, format, query] = await Promise.all([getT(), getFormat(), searchParams]);
  // Set when the review panel sent them here to add a role.
  const next = safeRedirectPath(query.next, "") || undefined;
  const { isLandlord, isRenter } = user;
  const roles = rolesOf(user);
  const both = roles.length > 1;

  const db = await getDb();
  const [aboutMe, propertyReviews, written, managed, added, kennitala, nameLocked] = await Promise.all([
    // Ratings are kept separately for each role.
    Promise.all(
      roles.map(async (role) => ({
        role,
        summary: await getRatingSummary({ userId: user.id, as: role }),
        reviews: await listReviewsAbout({ userId: user.id, as: role }, 1, ABOUT_ME_SHOWN),
      })),
    ),
    isLandlord ? listReviewsOfLandlordProperties(user.id, PROPERTY_REVIEWS_SHOWN) : null,
    listReviewsByAuthor(user.id, WRITTEN_SHOWN),
    isLandlord ? listProperties({ landlordId: user.id, sort: "name", pageSize: PROPERTIES_SHOWN }) : null,
    isRenter
      ? listProperties({
          createdById: user.id,
          notLandlordId: user.id,
          sort: "newest",
          pageSize: PROPERTIES_SHOWN,
        })
      : null,
    getOwnKennitala(user.id),
    isNameLocked(db, user.id),
  ]);
  // Just signed up with a kennitala others had reviewed: the page kept their name.
  const keptName = query.name === "kept" && nameLocked;
  const reportName = reportPath("profile", user.id);

  const propertySections = [
    managed && {
      id: "managed",
      title: t("account.properties.managed"),
      addHref: "/properties/new?as=landlord",
      result: managed,
      emptyTitle: t("account.properties.managedEmptyTitle"),
      emptyBody: t("account.properties.managedEmptyBody"),
    },
    added && {
      id: "added",
      title: t(isLandlord ? "account.properties.addedAsRenter" : "account.properties.added"),
      addHref: isLandlord ? "/properties/new?as=renter" : "/properties/new",
      result: added,
      emptyTitle: t("account.properties.addedEmptyTitle"),
      emptyBody: t("account.properties.addedEmptyBody"),
    },
  ].filter((section) => !!section);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6">
      <PageHeader
        title={t("account.dashboard.greeting", { name: user.name.split(" ")[0] })}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-all">{t("account.dashboard.signedInAs", { email: user.email })}</span>
            {roles.map((role) => (
              <RoleBadge key={role} role={role} />
            ))}
          </span>
        }
        actions={
          <ButtonLink href={profilePath(user)} variant="secondary">
            {t("account.dashboard.viewProfile")}
          </ButtonLink>
        }
      />

      {keptName && (
        <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink">
          {t.rich("account.dashboard.keptName", {
            report: (
              <Link href={reportName} className="font-semibold text-brand hover:underline">
                {t("account.dashboard.report")}
              </Link>
            ),
          })}
        </p>
      )}

      <section aria-label={t("account.dashboard.quickActions")} className="flex flex-wrap gap-2">
        {isRenter && <ButtonLink href="/landlords">{t("account.dashboard.reviewLandlord")}</ButtonLink>}
        {isLandlord && <ButtonLink href="/renters">{t("account.dashboard.reviewRenter")}</ButtonLink>}
        {isRenter && (
          <ButtonLink href="/properties" variant="secondary">
            {t("account.dashboard.reviewProperty")}
          </ButtonLink>
        )}
        <ButtonLink href={isLandlord ? "/properties/new?as=landlord" : "/properties/new"} variant="secondary">
          {t(isLandlord ? "account.dashboard.addProperty" : "account.dashboard.addPlaceYouRent")}
        </ButtonLink>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          {aboutMe.map(({ role, summary, reviews }) => (
            <section key={role} aria-labelledby={`about-me-${role}`} className="space-y-4">
              <div className="space-y-1">
                <h2 id={`about-me-${role}`} className="text-xl font-bold tracking-tight text-ink">
                  {t(both ? ABOUT_ME_HEADING[role] : "account.aboutYou.heading")}{" "}
                  <Count value={reviews.total} format={format} />
                </h2>
                <p className="text-sm text-muted">{t("account.aboutYou.cantRemove")}</p>
              </div>
              <Card>
                <RatingSummary summary={summary} />
              </Card>
              {reviews.items.length > 0 ? (
                <>
                  <ReviewList reviews={reviews.items} viewerId={user.id} />
                  <ShowingNote
                    t={t}
                    shown={reviews.items.length}
                    total={reviews.total}
                    href={`${profilePath(user, role)}#reviews`}
                    label={t("account.aboutYou.seeAll")}
                  />
                </>
              ) : (
                <EmptyState title={t(ABOUT_ME_EMPTY[role].title)}>{t(ABOUT_ME_EMPTY[role].body)}</EmptyState>
              )}
            </section>
          ))}

          {propertyReviews && (
            <section aria-labelledby="property-reviews-heading" className="space-y-4">
              <h2 id="property-reviews-heading" className="text-xl font-bold tracking-tight text-ink">
                {t("account.propertyReviews.heading")} <Count value={propertyReviews.total} format={format} />
              </h2>
              {propertyReviews.items.length > 0 ? (
                <>
                  <ReviewList reviews={propertyReviews.items} viewerId={user.id} showSubject />
                  <ShowingNote t={t} shown={propertyReviews.items.length} total={propertyReviews.total} />
                </>
              ) : (
                <EmptyState title={t("account.propertyReviews.empty")} />
              )}
            </section>
          )}

          <section aria-labelledby="written-heading" className="space-y-4">
            <h2 id="written-heading" className="text-xl font-bold tracking-tight text-ink">
              {t("account.written.heading")} <Count value={written.total} format={format} />
            </h2>
            {written.items.length > 0 ? (
              <>
                <ReviewList reviews={written.items} viewerId={user.id} showSubject />
                <ShowingNote t={t} shown={written.items.length} total={written.total} />
              </>
            ) : (
              <EmptyState
                title={t("account.written.empty")}
                action={
                  <ButtonLink href={isRenter ? "/landlords" : "/renters"}>
                    {t(isRenter ? "account.written.findLandlord" : "account.written.findRenter")}
                  </ButtonLink>
                }
              />
            )}
          </section>

          {propertySections.map((section) => (
            <section key={section.id} aria-labelledby={`${section.id}-heading`} className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <h2 id={`${section.id}-heading`} className="text-xl font-bold tracking-tight text-ink">
                  {section.title} <Count value={section.result.total} format={format} />
                </h2>
                <Link href={section.addHref} className="text-sm font-semibold text-brand hover:underline">
                  {t("account.properties.add")}
                </Link>
              </div>
              {section.result.items.length > 0 ? (
                <>
                  <CardGrid>
                    {section.result.items.map((property) => (
                      <li key={property.id}>
                        <PropertyCard property={property} />
                      </li>
                    ))}
                  </CardGrid>
                  <ShowingNote t={t} shown={section.result.items.length} total={section.result.total} />
                </>
              ) : (
                <EmptyState title={section.emptyTitle}>{section.emptyBody}</EmptyState>
              )}
            </section>
          ))}
        </div>

        <aside className="space-y-6">
          <Card as="section">
            <div id="roles">
              <h2 className="text-lg font-semibold text-ink">{t("account.roles.heading")}</h2>
              <p className="mt-1 text-sm text-muted">{t("account.roles.intro")}</p>
              <div className="mt-4">
                <RolesForm
                  isLandlord={isLandlord}
                  isRenter={isRenter}
                  reviewedAs={aboutMe.filter((section) => section.reviews.total > 0).map((s) => s.role)}
                  next={next}
                />
              </div>
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">{t("account.profile.heading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("account.profile.intro")}</p>
            {kennitala && (
              <div className="mt-4 rounded-xl border border-line bg-surface-muted px-3.5 py-2.5">
                <p className="text-sm text-ink">
                  {t("account.profile.kennitala", { kennitala: formatKennitala(kennitala) })}
                </p>
                <p className="mt-0.5 text-xs text-muted">{t("account.profile.kennitalaNote")}</p>
              </div>
            )}
            <div className="mt-5">
              <ProfileForm
                user={{ name: user.name, city: user.city, bio: user.bio }}
                nameLocked={nameLocked}
                reportHref={reportName}
              />
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">{t("account.password.heading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("account.password.intro")}</p>
            <div className="mt-5">
              <PasswordForm />
            </div>
            <div className="mt-5 border-t border-line pt-5">
              <SignOutOthersForm />
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">{t("account.close.heading")}</h2>
            <p className="mt-1 text-sm text-muted">{t("account.close.body")}</p>
            <p className="mt-1 text-sm text-muted">{t("account.close.again")}</p>
            <div className="mt-4">
              <DeleteAccount />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
