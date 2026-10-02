import type { Metadata } from "next";
import Link from "next/link";
import { signOutOtherDevices } from "@/app/actions/account";
import { CardGrid, PropertyCard } from "@/components/cards";
import { RatingSummary } from "@/components/rating-summary";
import { ReviewList } from "@/components/review-card";
import {
  ButtonLink,
  buttonStyles,
  Card,
  cx,
  EmptyState,
  Notice,
  PageHeader,
  RoleBadge,
} from "@/components/ui";
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
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My account" };

const ABOUT_ME_SHOWN = 20;
const PROPERTY_REVIEWS_SHOWN = 20;
const WRITTEN_SHOWN = 50;
const PROPERTIES_SHOWN = 60;

function ShowingNote({ shown, total, href, label }: { shown: number; total: number; href?: string; label?: string }) {
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
  const { signedOut } = await searchParams;
  const isLandlord = user.role === "landlord";

  const [summary, aboutMe, propertyReviews, written, myProperties] = await Promise.all([
    getRatingSummary({ userId: user.id }),
    listReviewsAbout({ userId: user.id }, 1, ABOUT_ME_SHOWN),
    isLandlord ? listReviewsOfLandlordProperties(user.id, PROPERTY_REVIEWS_SHOWN) : null,
    listReviewsByAuthor(user.id, WRITTEN_SHOWN),
    listProperties(
      isLandlord
        ? { landlordId: user.id, sort: "name", pageSize: PROPERTIES_SHOWN }
        : { createdById: user.id, sort: "newest", pageSize: PROPERTIES_SHOWN },
    ),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-10 sm:px-6">
      {signedOut === "others" && (
        <Notice tone="success">You&apos;ve been signed out on all your other devices.</Notice>
      )}
      <PageHeader
        title={<>Hi, {user.name.split(" ")[0]}</>}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="break-all">Signed in as {user.email}</span> <RoleBadge role={user.role} />
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          <section aria-labelledby="about-me-heading" className="space-y-4">
            <h2 id="about-me-heading" className="text-xl font-bold tracking-tight text-ink">
              Reviews about you <span className="font-normal text-muted">({aboutMe.total})</span>
            </h2>
            <Card>
              <RatingSummary summary={summary} />
            </Card>
            {aboutMe.items.length > 0 ? (
              <>
                <ReviewList reviews={aboutMe.items} viewerId={user.id} />
                <ShowingNote
                  shown={aboutMe.items.length}
                  total={aboutMe.total}
                  href={`${profilePath(user)}#reviews`}
                  label="See them all on your profile"
                />
              </>
            ) : (
              <EmptyState title="No one has reviewed you yet">
                {isLandlord
                  ? "When your renters review you, it'll show up here. Share your profile link with them!"
                  : "When your landlords review you, it'll show up here."}
              </EmptyState>
            )}
          </section>

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
              <>
                <CardGrid>
                  {myProperties.items.map((property) => (
                    <li key={property.id}>
                      <PropertyCard property={property} />
                    </li>
                  ))}
                </CardGrid>
                <ShowingNote shown={myProperties.items.length} total={myProperties.total} />
              </>
            ) : (
              <EmptyState
                title={isLandlord ? "You haven't listed any properties" : "You haven't added any properties"}
              >
                {isLandlord
                  ? "Add the homes you rent out so your renters can review them. If a renter already listed one, open it and choose “I manage this property”."
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
            <h2 className="text-lg font-semibold text-ink">Password &amp; sessions</h2>
            <p className="mt-1 text-sm text-muted">
              Changing your password signs you out everywhere else.
            </p>
            <div className="mt-5">
              <PasswordForm />
            </div>
            <form action={signOutOtherDevices} className="mt-5 border-t border-line pt-5">
              <button type="submit" className={cx(buttonStyles.base, buttonStyles.secondary)}>
                Sign out other devices
              </button>
            </form>
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
