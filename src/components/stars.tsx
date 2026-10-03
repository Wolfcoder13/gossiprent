import { cx } from "./ui";

export const STAR_PATH =
  "M12 2.5l2.94 6.11 6.56.84-4.82 4.6 1.2 6.55L12 17.4l-5.88 3.2 1.2-6.55-4.82-4.6 6.56-.84L12 2.5z";

const SIZES = {
  sm: "size-4",
  md: "size-5",
};

function StarRow({ className, size }: { className: string; size: keyof typeof SIZES }) {
  return (
    <span className={cx("flex", className)}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className={cx(SIZES[size], "shrink-0 fill-current")}>
          <path d={STAR_PATH} />
        </svg>
      ))}
    </span>
  );
}

/** Read-only star rating that supports fractions (e.g. 4.3 fills 4.3 stars). */
export function Stars({
  rating,
  size = "md",
  className,
}: {
  rating: number | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const value = rating === null ? 0 : Math.max(0, Math.min(5, rating));
  const label =
    rating === null ? "No ratings yet" : `Rated ${formatRating(rating)} out of 5 stars`;
  return (
    <span role="img" aria-label={label} className={cx("relative inline-flex", className)}>
      <StarRow className="text-star-empty" size={size} />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${(value / 5) * 100}%` }}>
        <StarRow className="text-star" size={size} />
      </span>
    </span>
  );
}

/** "4.3", "5", or "—" */
export function formatRating(rating: number | null): string {
  if (rating === null) return "—";
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

/** Stars plus "4.3 · 12 reviews". */
export function RatingInline({ average, count }: { average: number | null; count: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Stars rating={average} size="sm" />
      {count > 0 ? (
        <span className="text-muted">
          <span className="font-semibold text-ink">{formatRating(average)}</span> ·{" "}
          {count} {count === 1 ? "review" : "reviews"}
        </span>
      ) : (
        <span className="text-muted">No reviews yet</span>
      )}
    </span>
  );
}
