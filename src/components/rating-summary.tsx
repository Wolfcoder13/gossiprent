"use client";

import { useFormat, useT } from "@/i18n/client";
import type { RatingSummary as Summary } from "@/lib/data";
import { Stars } from "./stars";

const STAR_ROWS = [5, 4, 3, 2, 1];

/** Big average score plus a 5→1 star breakdown. A client component (useT), usable anywhere. */
export function RatingSummary({ summary }: { summary: Summary }) {
  const t = useT();
  const format = useFormat();
  const max = Math.max(1, ...summary.distribution);
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="shrink-0 text-center sm:w-36">
        <p className="text-5xl font-bold tracking-tight text-ink">{format.rating(summary.average)}</p>
        <Stars rating={summary.average} className="mt-1" />
        <p className="mt-1 text-sm text-muted">
          {summary.count > 0
            ? t("common.rating.reviewCount", { count: summary.count })
            : t("common.rating.noReviews")}
        </p>
      </div>
      <ul className="flex-1 space-y-1.5" aria-label={t("common.rating.breakdown")}>
        {STAR_ROWS.map((stars) => {
          const n = summary.distribution[stars - 1];
          return (
            <li key={stars} className="flex items-center gap-3 text-sm">
              <span className="w-18 shrink-0 text-muted">{t("common.rating.starCount", { count: stars })}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-star"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="min-w-6 shrink-0 text-right tabular-nums text-muted">
                {format.number(n)}
                <span className="sr-only"> {t("common.rating.reviewsUnit", { count: n })}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
