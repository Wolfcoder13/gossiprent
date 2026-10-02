import type { RatingSummary as Summary } from "@/lib/data";
import { plural } from "@/lib/format";
import { formatRating, Stars } from "./stars";

/** Big average score plus a 5→1 star breakdown. */
export function RatingSummary({ summary }: { summary: Summary }) {
  const max = Math.max(1, ...summary.distribution);
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="shrink-0 text-center sm:w-36">
        <p className="text-5xl font-bold tracking-tight text-ink">{formatRating(summary.average)}</p>
        <Stars rating={summary.average} className="mt-1" />
        <p className="mt-1 text-sm text-muted">
          {summary.count > 0 ? plural(summary.count, "review") : "No reviews yet"}
        </p>
      </div>
      <ul className="flex-1 space-y-1.5" aria-label="Rating breakdown">
        {[5, 4, 3, 2, 1].map((stars) => {
          const n = summary.distribution[stars - 1];
          return (
            <li key={stars} className="flex items-center gap-3 text-sm">
              <span className="w-14 shrink-0 text-muted">
                {stars} {stars === 1 ? "star" : "stars"}
              </span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-star"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right tabular-nums text-muted">
                {n}
                <span className="sr-only"> {n === 1 ? "review" : "reviews"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
