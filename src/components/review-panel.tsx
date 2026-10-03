import Link from "next/link";
import type { ReactNode } from "react";
import type { ReviewKind } from "@/db/schema";
import { getFormat, getT } from "@/i18n/server";
import type { SessionUser } from "@/lib/auth/current-user";
import type { ReviewItem } from "@/lib/data";
import { hasRole, reviewerRole as reviewerRoleFor } from "@/lib/roles";
import { ReviewForm } from "./review-form";
import { ButtonLink, Card } from "./ui";

// Message keys, per kind of review or per role needed to write it.
const INVITE = {
  landlord: "reviews.panel.invite.landlord",
  renter: "reviews.panel.invite.renter",
  property: "reviews.panel.invite.property",
} as const;
const LOG_IN_OR_SIGN_UP = {
  landlord: "reviews.panel.logInOrSignUp.landlord",
  renter: "reviews.panel.logInOrSignUp.renter",
} as const;
const SIGN_UP_AS = {
  landlord: "reviews.panel.signUpAs.landlord",
  renter: "reviews.panel.signUpAs.renter",
} as const;
const NOT_ALLOWED = {
  landlord: "reviews.panel.notAllowed.landlord",
  renter: "reviews.panel.notAllowed.renter",
  property: "reviews.panel.notAllowed.property",
} as const;
const LOST_ROLE = {
  landlord: "reviews.panel.lostRole.landlord",
  renter: "reviews.panel.lostRole.renter",
  property: "reviews.panel.lostRole.property",
} as const;
const ADD_ROLE = {
  landlord: "reviews.panel.addRole.landlord",
  renter: "reviews.panel.addRole.renter",
} as const;
const NEW_INTRO = {
  landlord: "reviews.panel.newIntro.landlord",
  renter: "reviews.panel.newIntro.renter",
  property: "reviews.panel.newIntro.property",
} as const;

/**
 * The "write a review" box on a landlord, renter, or property page. Shows the
 * form to people allowed to review this subject, and a short explanation to
 * everyone else.
 */
export async function ReviewPanel({
  kind,
  subjectId,
  subjectName,
  viewer,
  existing,
  returnTo,
  ownerNote,
  saved = false,
}: {
  kind: ReviewKind;
  subjectId: string;
  /** The person's name or the property's address, for the form's heading. */
  subjectName: string;
  viewer: SessionUser | null;
  existing: ReviewItem | null;
  /** This page, so logging in brings the visitor back here. */
  returnTo: string;
  /** Shown instead of the form when the viewer is the subject (or owns the property). Already translated. */
  ownerNote?: string;
  /** The author just posted their review from /reviews/new (?saved=1): thank them. */
  saved?: boolean;
}) {
  const t = await getT();
  const reviewerRole = reviewerRoleFor(kind);
  const next = encodeURIComponent(returnTo);

  let content: ReactNode;
  if (!viewer) {
    content = (
      <>
        <h2 className="text-lg font-semibold wrap-anywhere text-ink">{t(INVITE[kind])}</h2>
        <p className="mt-1 text-sm text-muted">{t(LOG_IN_OR_SIGN_UP[reviewerRole])}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href={`/signup?role=${reviewerRole}&next=${next}`}>{t(SIGN_UP_AS[reviewerRole])}</ButtonLink>
          <ButtonLink href={`/login?next=${next}`} variant="secondary">
            {t("reviews.panel.logIn")}
          </ButtonLink>
        </div>
      </>
    );
  } else if (ownerNote) {
    content = <p className="text-sm text-muted">{ownerNote}</p>;
  } else if (!hasRole(viewer, reviewerRole)) {
    const addRole = (
      <Link href={`/dashboard?next=${next}#roles`} className="font-semibold text-brand hover:underline">
        {t(ADD_ROLE[reviewerRole])}
      </Link>
    );
    content = (
      <p className="text-sm text-muted">
        {existing ? t.rich(LOST_ROLE[kind], { addRole }) : t.rich(NOT_ALLOWED[kind], { addRole })}
      </p>
    );
  } else {
    content = (
      <>
        <h2 className="text-lg font-semibold wrap-anywhere text-ink">
          {existing ? t("reviews.panel.yourReview") : t("reviews.panel.newHeading", { name: subjectName })}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {existing ? t("reviews.panel.editIntro") : t(NEW_INTRO[kind])}
        </p>
        <div className="mt-5">
          <ReviewForm
            kind={kind}
            subjectId={subjectId}
            existing={existing && { rating: existing.rating, title: existing.title, body: existing.body }}
            savedMessage={saved && existing ? t("reviews.messages.live") : undefined}
          />
        </div>
      </>
    );
  }

  return (
    <Card as="section">
      <div id="your-review">{content}</div>
    </Card>
  );
}

/** "Reviews (3)": the heading over a list of reviews. */
export async function ReviewsHeading({
  id,
  count,
  label,
}: {
  id?: string;
  count: number;
  /** Defaults to "Reviews". Already translated. */
  label?: string;
}) {
  const [t, format] = await Promise.all([getT(), getFormat()]);
  return (
    <h2 id={id} className="text-xl font-bold tracking-tight text-ink">
      {label ?? t("reviews.heading")} <span className="font-normal text-muted">({format.number(count)})</span>
    </h2>
  );
}
