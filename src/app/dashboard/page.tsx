import type { Metadata } from "next";
import Link from "next/link";
import { CardGrid, PropertyCard } from "@/components/cards";
import { RatingSummary } from "@/components/rating-summary";
import { ReviewList } from "@/components/review-card";
import { ButtonLink, Card, EmptyState, PageHeader, RoleBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth/current-user";
import {
  getRatingSummary,
  listProperties,
  listReviewsAbout,
  listReviewsByAuthor,
  listReviewsOfLandlordProperties,
} from "@/lib/data";
import type { UserRole } from "@/db/schema";
import { profilePath } from "@/lib/paths";
import { rolesOf } from "@/lib/roles";
import { safeRedirectPath } from "@/lib/validation";
import { DeleteAccount } from "./delete-account";
import { PasswordForm, SignOutOthersForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { RolesForm } from "./roles-form";

export const metadata: Metadata = { title: "My account" };

const ABOUT_ME_SHOWN = 20;
const PROPERTY_REVIEWS_SHOWN = 20;
const WRITTEN_SHOWN = 50;
const PROPERTIES_SHOWN = 60;

const REVIEWED_BY: Record<UserRole, string> = { landlord: "renters", renter: "landlords" };

function ShowingNote({
  shown,
  total,
  href,
  label,
}: {
  shown: number;
  total: number;
  href?: string;
  label?: string;
}) {
  if (total <= shown) return null;
  return (
    <p className="text-sm text-muted">
      Showing the latest {shown} of {total}.{" "}
      {href && (
        <Link href={href} className="font-semibold text-brand hover:underline">
          {label}
        </Link>
      )}
    </p>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  // Set when the review panel sent them here to add a role.
  const next = safeRedirectPath((await searchParams).next, "") || undefined;
  const { isLandlord, isRenter } = user;
  const roles = rolesOf(user);
  const both = roles.length > 1;

  const [aboutMe, propertyReviews, written, managed, added] = await Promise.all([
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
  ]);

  const propertySections = [
    managed && {
      id: "managed",
      title: "Your properties",
      addHref: "/properties/new?as=landlord",
      result: managed,
      emptyTitle: "You haven't listed any properties",
      emptyBody:
        "Add the homes you rent out so your renters can review them. If a renter already listed one, open it and choose “I manage this property”.",
    },
    added && {
      id: "added",
      title: isLandlord ? "Places you added as a renter" : "Properties you added",
      addHref: isLandlord ? "/properties/new?as=renter" : "/properties/new",
      result: added,
      emptyTitle: "You haven't added any properties",
      emptyBody: "Can't find the place you rent? Add it so you can review it.",
    },
  ].filter((section) => !!section);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6">
      <PageHeader
        title={<>Hi, {user.name.split(" ")[0]}</>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-all">Signed in as {user.email}</span>
            {roles.map((role) => (
              <RoleBadge key={role} role={role} />
            ))}
          </span>
        }
        actions={
          <ButtonLink href={profilePath(user)} variant="secondary">
            View public profile
          </ButtonLink>
        }
      />

      <section aria-label="Quick actions" className="flex flex-wrap gap-2">
        {isRenter && <ButtonLink href="/landlords">Review a landlord</ButtonLink>}
        {isLandlord && <ButtonLink href="/renters">Review a renter</ButtonLink>}
        {isRenter && (
          <ButtonLink href="/properties" variant="secondary">
            Review a property
          </ButtonLink>
        )}
        <ButtonLink href={isLandlord ? "/properties/new?as=landlord" : "/properties/new"} variant="secondary">
          {isLandlord ? "Add a property" : "Add the place you rent"}
        </ButtonLink>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          {aboutMe.map(({ role, summary, reviews }) => (
            <section key={role} aria-labelledby={`about-me-${role}`} className="space-y-4">
              <h2 id={`about-me-${role}`} className="text-xl font-bold tracking-tight text-ink">
                Reviews about you{both ? ` as a ${role}` : ""}{" "}
                <span className="font-normal text-muted">({reviews.total})</span>
              </h2>
              <Card>
                <RatingSummary summary={summary} />
              </Card>
              {reviews.items.length > 0 ? (
                <>
                  <ReviewList reviews={reviews.items} viewerId={user.id} />
                  <ShowingNote
                    shown={reviews.items.length}
                    total={reviews.total}
                    href={`${profilePath(user, role)}#reviews`}
                    label="See them all on your profile"
                  />
                </>
              ) : (
                <EmptyState title={`No ${REVIEWED_BY[role]} have reviewed you yet`}>
                  {role === "landlord"
                    ? "When your renters review you, it'll show up here. Share your profile link with them!"
                    : "When your landlords review you, it'll show up here."}
                </EmptyState>
              )}
            </section>
          ))}

          {propertyReviews && (
            <section aria-labelledby="property-reviews-heading" className="space-y-4">
              <h2 id="property-reviews-heading" className="text-xl font-bold tracking-tight text-ink">
                Reviews of your properties{" "}
                <span className="font-normal text-muted">({propertyReviews.total})</span>
              </h2>
              {propertyReviews.items.length > 0 ? (
                <>
                  <ReviewList reviews={propertyReviews.items} viewerId={user.id} showSubject />
                  <ShowingNote shown={propertyReviews.items.length} total={propertyReviews.total} />
                </>
              ) : (
                <EmptyState title="No property reviews yet" />
              )}
            </section>
          )}

          <section aria-labelledby="written-heading" className="space-y-4">
            <h2 id="written-heading" className="text-xl font-bold tracking-tight text-ink">
              Reviews you&apos;ve written <span className="font-normal text-muted">({written.total})</span>
            </h2>
            {written.items.length > 0 ? (
              <>
                <ReviewList reviews={written.items} viewerId={user.id} showSubject />
                <ShowingNote shown={written.items.length} total={written.total} />
              </>
            ) : (
              <EmptyState
                title="You haven't written any reviews yet"
                action={
                  <ButtonLink href={isRenter ? "/landlords" : "/renters"}>
                    {isRenter ? "Find your landlord" : "Find a renter to review"}
                  </ButtonLink>
                }
              />
            )}
          </section>

          {propertySections.map((section) => (
            <section key={section.id} aria-labelledby={`${section.id}-heading`} className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <h2 id={`${section.id}-heading`} className="text-xl font-bold tracking-tight text-ink">
                  {section.title} <span className="font-normal text-muted">({section.result.total})</span>
                </h2>
                <Link href={section.addHref} className="text-sm font-semibold text-brand hover:underline">
                  Add a property
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
                  <ShowingNote shown={section.result.items.length} total={section.result.total} />
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
              <h2 className="text-lg font-semibold text-ink">Your roles</h2>
              <p className="mt-1 text-sm text-muted">
                Rent a home and also rent one out? Have both. You get a separate rating for each.
              </p>
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
            <h2 className="text-lg font-semibold text-ink">Your profile</h2>
            <p className="mt-1 text-sm text-muted">This is what people see on your public page.</p>
            <div className="mt-5">
              <ProfileForm user={{ name: user.name, city: user.city, bio: user.bio }} />
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">Password &amp; sessions</h2>
            <p className="mt-1 text-sm text-muted">
              Changing your password signs you out everywhere else.
            </p>
            <div className="mt-5">
              <PasswordForm />
            </div>
            <div className="mt-5 border-t border-line pt-5">
              <SignOutOthersForm />
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">Close account</h2>
            <p className="mt-1 text-sm text-muted">
              Deletes your login and the reviews you wrote. Reviews other people wrote about you stay
              public on your profile, marked as closed.
            </p>
            <div className="mt-4">
              <DeleteAccount />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
