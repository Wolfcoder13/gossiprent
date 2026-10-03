"use client";

import { useFormat, useT } from "@/i18n/client";
import { cx } from "./ui";

// Client components (translated with useT/useFormat), so they work in server
// and client trees alike.

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
  const t = useT();
  const format = useFormat();
  const value = rating === null ? 0 : Math.max(0, Math.min(5, rating));
  const label =
    rating === null ? t("common.rating.none") : t("common.rating.stars", { rating: format.rating(rating) });
  return (
    <span role="img" aria-label={label} className={cx("relative inline-flex", className)}>
      <StarRow className="text-star-empty" size={size} />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${(value / 5) * 100}%` }}>
        <StarRow className="text-star" size={size} />
      </span>
    </span>
  );
}

/** Stars plus "4.3 · 12 reviews" ("4,3 · 12 umsagnir"). */
export function RatingInline({ average, count }: { average: number | null; count: number }) {
  const t = useT();
  const format = useFormat();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Stars rating={average} size="sm" />
      {count > 0 ? (
        <span className="text-muted">
          <span className="font-semibold text-ink">{format.rating(average)}</span> ·{" "}
          {t("common.rating.reviewCount", { count })}
        </span>
      ) : (
        <span className="text-muted">{t("common.rating.noReviews")}</span>
      )}
    </span>
  );
}
