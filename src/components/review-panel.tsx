import Link from "next/link";
import type { ReactNode } from "react";
import type { ReviewKind } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/current-user";
import type { ReviewItem } from "@/lib/data";
import { hasRole } from "@/lib/roles";
import { ReviewForm } from "./review-form";
import { ButtonLink, Card } from "./ui";

const WHO_CAN_REVIEW: Record<ReviewKind, "renter" | "landlord"> = {
  landlord: "renter",
  renter: "landlord",
  property: "renter",
};

const INVITE: Record<ReviewKind, string> = {
  landlord: "Rented from {name}?",
  renter: "Rented to {name}?",
  property: "Lived at {name}?",
};

/**
 * The "write a review" box on a landlord, renter, or property page. Shows the
 * form to people allowed to review this subject, and a short explanation to
 * everyone else.
 */
export function ReviewPanel({
  kind,
  subjectId,
  subjectName,
  viewer,
  existing,
  returnTo,
  ownerNote,
}: {
  kind: ReviewKind;
  subjectId: string;
  subjectName: string;
  viewer: SessionUser | null;
  existing: ReviewItem | null;
  /** This page, so logging in brings the visitor back here. */
  returnTo: string;
  /** Shown instead of the form when the viewer is the subject (or owns the property). */
  ownerNote?: string;
}) {
  const reviewerRole = WHO_CAN_REVIEW[kind];
  const invite = INVITE[kind].replace("{name}", subjectName);
  const next = encodeURIComponent(returnTo);

  let content: ReactNode;
  if (!viewer) {
    content = (
      <>
        <h2 className="text-lg font-semibold wrap-anywhere text-ink">{invite}</h2>
        <p className="mt-1 text-sm text-muted">
          Log in or create a free {reviewerRole} account to leave a star rating and a written review.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href={`/signup?role=${reviewerRole}&next=${next}`}>
            Sign up as a {reviewerRole}
          </ButtonLink>
          <ButtonLink href={`/login?next=${next}`} variant="secondary">
            Log in
          </ButtonLink>
        </div>
      </>
    );
  } else if (ownerNote) {
    content = <p className="text-sm text-muted">{ownerNote}</p>;
  } else if (!hasRole(viewer, reviewerRole)) {
    const addRole = (
      <Link href={`/dashboard?next=${next}#roles`} className="font-semibold text-brand hover:underline">
        add the {reviewerRole} role to your account
      </Link>
    );
    content = existing ? (
      <p className="text-sm text-muted">
        You reviewed {subjectName} as a {reviewerRole}. To edit that review, {addRole} again. You can
        still delete it from the reviews list.
      </p>
    ) : (
      <p className="text-sm text-muted">
        Only {reviewerRole}s can review {kind === "property" ? "properties" : `${kind}s`}. If you
        {reviewerRole === "renter" ? " rent too" : " rent out a home too"}, {addRole}.
      </p>
    );
  } else {
    content = (
      <>
        <h2 className="text-lg font-semibold wrap-anywhere text-ink">
          {existing ? "Your review" : `Review ${subjectName}`}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {existing ? (
            <>You can update your review any time. It&apos;s shown publicly with your name.</>
          ) : (
            <>Your review is public and shows your name. One review per {kind === "property" ? "property" : kind}.</>
          )}
        </p>
        <div className="mt-5">
          <ReviewForm
            kind={kind}
            subjectId={subjectId}
            existing={existing && { rating: existing.rating, title: existing.title, body: existing.body }}
          />
        </div>
      </>
    );
  }

  return (
    <Card as="section">
      <div id="your-review">
        {content}
      </div>
    </Card>
  );
}

export function ReviewsHeading({
  id,
  count,
  label = "Reviews",
}: {
  id?: string;
  count: number;
  label?: string;
}) {
  return (
    <h2 id={id} className="text-xl font-bold tracking-tight text-ink">
      {label} <span className="font-normal text-muted">({count})</span>
    </h2>
  );
}
