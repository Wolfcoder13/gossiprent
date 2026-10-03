import Link from "next/link";
import { addressText } from "@/i18n/address";
import { getFormat, getT, type T } from "@/i18n/server";
import type { Format } from "@/i18n/format";
import type { ReviewItem } from "@/lib/data";
import { profilePath, reportPath, subjectPath } from "@/lib/paths";
import { DeleteReviewButton } from "./delete-review-button";
import { Stars } from "./stars";
import { Avatar, cx, RoleBadge } from "./ui";

// Message keys: what a review is about, one whole sentence per kind.
const SUBJECT = {
  landlord: "reviews.card.subject.landlord",
  renter: "reviews.card.subject.renter",
  property: "reviews.card.subject.property",
} as const;

/** "Reviewed Jón Jónsson" / "Lived at Njálsgata 23, apt. 0201, 101 Reykjavík", with a link. */
function SubjectLine({ review, t }: { review: ReviewItem; t: T }) {
  const subject = review.subject;
  const link = (text: string) => (
    <Link href={subjectPath(subject.kind, subject.id)} className="break-words font-medium text-ink hover:underline">
      {text}
    </Link>
  );
  return (
    <p className="mt-3 text-sm text-muted">
      {subject.kind === "property"
        ? t.rich(SUBJECT.property, { address: link(addressText(t, subject)) })
        : t.rich(SUBJECT[subject.kind], { name: link(subject.name) })}
    </p>
  );
}

function ReviewCard({
  review,
  viewerId,
  showSubject,
  t,
  format,
}: {
  review: ReviewItem;
  viewerId?: string;
  showSubject: boolean;
  t: T;
  format: Format;
}) {
  const isMine = viewerId === review.author.id;
  const edited = review.updatedAt.getTime() - review.createdAt.getTime() > 60_000;
  const subjectHref = subjectPath(review.subject.kind, review.subject.id);

  return (
    <article
      id={`review-${review.id}`}
      className={cx(
        "rounded-2xl border bg-surface p-5 shadow-sm",
        isMine ? "border-brand/40 ring-1 ring-brand/20" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={review.author.name} id={review.author.id} size="sm" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={profilePath(review.author, review.author.role)}
                className="truncate font-semibold text-ink hover:underline"
              >
                {review.author.name}
              </Link>
              <RoleBadge role={review.author.role} />
              {isMine && <span className="text-xs font-semibold text-brand">{t("reviews.card.you")}</span>}
            </div>
            <p className="text-xs text-muted">
              <time dateTime={review.createdAt.toISOString()}>{format.date(review.createdAt)}</time>
              {edited && <span> · {t("reviews.card.edited")}</span>}
            </p>
          </div>
        </div>
        <span className="flex items-center gap-1.5">
          <Stars rating={review.rating} size="sm" />
          <span aria-hidden className="text-sm font-semibold tabular-nums text-ink">
            {review.rating}/5
          </span>
        </span>
      </header>

      {showSubject && <SubjectLine review={review} t={t} />}

      <h3 className="mt-3 break-words font-semibold text-ink">{review.title}</h3>
      <p className="mt-1.5 whitespace-pre-line break-words text-ink/85">{review.body}</p>

      {isMine ? (
        <footer className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          {/* A plain anchor (not next/link) so keyboard focus moves to the form too. */}
          <a
            href={`${subjectHref}#your-review`}
            className="rounded-full px-3 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
          >
            {t("reviews.card.edit")}
          </a>
          <DeleteReviewButton reviewId={review.id} />
        </footer>
      ) : (
        <footer className="mt-3 flex justify-end">
          <Link
            href={reportPath("review", review.id)}
            rel="nofollow"
            className="rounded-full px-2 py-0.5 text-xs text-muted hover:bg-surface-muted hover:text-ink"
          >
            {t("reviews.card.report")}
          </Link>
        </footer>
      )}
    </article>
  );
}

/** A list of review cards. A Server Component (dates are formatted for the visitor). */
export async function ReviewList({
  reviews,
  viewerId,
  showSubject = false,
}: {
  reviews: ReviewItem[];
  /** The signed-in user, so their own reviews get edit/delete controls (and others' a report link). */
  viewerId?: string;
  /** Show what each review is about (for feeds that mix subjects). */
  showSubject?: boolean;
}) {
  const [t, format] = await Promise.all([getT(), getFormat()]);
  return (
    <ul className="space-y-4">
      {reviews.map((review) => (
        <li key={review.id}>
          <ReviewCard review={review} viewerId={viewerId} showSubject={showSubject} t={t} format={format} />
        </li>
      ))}
    </ul>
  );
}
