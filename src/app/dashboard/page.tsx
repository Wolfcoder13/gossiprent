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
import { profilePath } from "@/lib/paths";
import { DeleteAccount } from "./delete-account";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My account" };

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const isLandlord = user.role === "landlord";

  const [summary, aboutMe, propertyReviews, written, myProperties] = await Promise.all([
    getRatingSummary({ userId: user.id }),
    listReviewsAbout({ userId: user.id }, 1, 50),
    isLandlord ? listReviewsOfLandlordProperties(user.id) : [],
    listReviewsByAuthor(user.id),
    listProperties(
      isLandlord
        ? { landlordId: user.id, sort: "name", pageSize: 60 }
        : { createdById: user.id, sort: "newest", pageSize: 60 },
    ),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6">
      <PageHeader
        title={<>Hi, {user.name.split(" ")[0]}</>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            Signed in as {user.email} <RoleBadge role={user.role} />
          </span>
        }
        actions={
          <ButtonLink href={profilePath(user)} variant="secondary">
            View public profile
          </ButtonLink>
        }
      />

      <section aria-label="Quick actions" className="flex flex-wrap gap-2">
        {isLandlord ? (
          <>
            <ButtonLink href="/renters">Review a renter</ButtonLink>
            <ButtonLink href="/properties/new" variant="secondary">
              Add a property
            </ButtonLink>
          </>
        ) : (
          <>
            <ButtonLink href="/landlords">Review a landlord</ButtonLink>
            <ButtonLink href="/properties" variant="secondary">
              Review a property
            </ButtonLink>
            <ButtonLink href="/properties/new" variant="secondary">
              Add the place you rent
            </ButtonLink>
          </>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <section aria-labelledby="about-me-heading" className="space-y-4">
            <h2 id="about-me-heading" className="text-xl font-bold tracking-tight text-ink">
              Reviews about you <span className="font-normal text-muted">({aboutMe.total})</span>
            </h2>
            <Card>
              <RatingSummary summary={summary} />
            </Card>
            {aboutMe.items.length > 0 ? (
              <ReviewList reviews={aboutMe.items} viewerId={user.id} />
            ) : (
              <EmptyState title="No one has reviewed you yet">
                {isLandlord
                  ? "When your renters review you, it'll show up here. Share your profile link with them!"
                  : "When your landlords review you, it'll show up here."}
              </EmptyState>
            )}
          </section>

          {isLandlord && (
            <section aria-labelledby="property-reviews-heading" className="space-y-4">
              <h2 id="property-reviews-heading" className="text-xl font-bold tracking-tight text-ink">
                Reviews of your properties{" "}
                <span className="font-normal text-muted">({propertyReviews.length})</span>
              </h2>
              {propertyReviews.length > 0 ? (
                <ReviewList reviews={propertyReviews} viewerId={user.id} showSubject />
              ) : (
                <EmptyState title="No property reviews yet" />
              )}
            </section>
          )}

          <section aria-labelledby="written-heading" className="space-y-4">
            <h2 id="written-heading" className="text-xl font-bold tracking-tight text-ink">
              Reviews you&apos;ve written <span className="font-normal text-muted">({written.length})</span>
            </h2>
            {written.length > 0 ? (
              <ReviewList reviews={written} viewerId={user.id} showSubject />
            ) : (
              <EmptyState
                title="You haven't written any reviews yet"
                action={
                  <ButtonLink href={isLandlord ? "/renters" : "/landlords"}>
                    {isLandlord ? "Find a renter to review" : "Find your landlord"}
                  </ButtonLink>
                }
              />
            )}
          </section>

          <section aria-labelledby="properties-heading" className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <h2 id="properties-heading" className="text-xl font-bold tracking-tight text-ink">
                {isLandlord ? "Your properties" : "Properties you added"}{" "}
                <span className="font-normal text-muted">({myProperties.total})</span>
              </h2>
              <Link href="/properties/new" className="text-sm font-semibold text-brand hover:underline">
                Add a property
              </Link>
            </div>
            {myProperties.items.length > 0 ? (
              <CardGrid>
                {myProperties.items.map((property) => (
                  <li key={property.id}>
                    <PropertyCard property={property} />
                  </li>
                ))}
              </CardGrid>
            ) : (
              <EmptyState title={isLandlord ? "You haven't listed any properties" : "You haven't added any properties"}>
                {isLandlord
                  ? "Add the homes you rent out so your renters can review them."
                  : "Can't find the place you rent? Add it so you can review it."}
              </EmptyState>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">Your profile</h2>
            <p className="mt-1 text-sm text-muted">This is what people see on your public page.</p>
            <div className="mt-5">
              <ProfileForm user={{ name: user.name, city: user.city, bio: user.bio }} />
            </div>
          </Card>
          <Card as="section">
            <h2 className="text-lg font-semibold text-ink">Delete account</h2>
            <p className="mt-1 text-sm text-muted">
              Permanently removes your account, the reviews you wrote, and the reviews written about you.
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
