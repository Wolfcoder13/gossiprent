import Link from "next/link";
import type { ReviewItem } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { profilePath, subjectPath } from "@/lib/paths";
import { DeleteReviewButton } from "./delete-review-button";
import { Stars } from "./stars";
import { Avatar, cx, RoleBadge } from "./ui";

export function ReviewCard({
  review,
  viewerId,
  showSubject = false,
  editHref,
}: {
  review: ReviewItem;
  /** The signed-in user, so their own reviews get edit/delete controls. */
  viewerId?: string;
  /** Show what the review is about (for feeds that mix subjects). */
  showSubject?: boolean;
  /** Where "Edit" goes for the viewer's own review. Defaults to the subject's page. */
  editHref?: string;
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
                href={profilePath(review.author)}
                className="truncate font-semibold text-ink hover:underline"
              >
                {review.author.name}
              </Link>
              <RoleBadge role={review.author.role} />
              {isMine && (
                <span className="text-xs font-semibold text-brand">You</span>
              )}
            </div>
            <p className="text-xs text-muted">
              <time dateTime={review.createdAt.toISOString()}>{formatDate(review.createdAt)}</time>
              {edited && <span> · edited</span>}
            </p>
          </div>
        </div>
        <Stars rating={review.rating} size="sm" />
      </header>

      {showSubject && (
        <p className="mt-3 text-sm text-muted">
          {review.subject.kind === "property" ? "Lived at " : "Reviewed "}
          <Link href={subjectHref} className="font-medium text-ink hover:underline">
            {review.subject.name}
          </Link>
        </p>
      )}

      <h3 className="mt-3 font-semibold text-ink">{review.title}</h3>
      <p className="mt-1.5 whitespace-pre-line break-words text-ink/85">{review.body}</p>

      {isMine && (
        <footer className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <Link
            href={editHref ?? `${subjectHref}#your-review`}
            className="rounded-full px-3 py-1 text-xs font-semibold text-brand hover:bg-brand-soft"
          >
            Edit
          </Link>
          <DeleteReviewButton reviewId={review.id} />
        </footer>
      )}
    </article>
  );
}

export function ReviewList({
  reviews,
  viewerId,
  showSubject,
}: {
  reviews: ReviewItem[];
  viewerId?: string;
  showSubject?: boolean;
}) {
  return (
    <ul className="space-y-4">
      {reviews.map((review) => (
        <li key={review.id}>
          <ReviewCard review={review} viewerId={viewerId} showSubject={showSubject} />
        </li>
      ))}
    </ul>
  );
}
