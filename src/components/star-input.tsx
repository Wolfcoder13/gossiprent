"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { STAR_PATH } from "./stars";
import { cx } from "./ui";

/** What each number of stars means, from 1 to 5. */
const LABELS = [
  "common.starInput.terrible",
  "common.starInput.poor",
  "common.starInput.okay",
  "common.starInput.good",
  "common.starInput.excellent",
] as const;

/**
 * Accessible 1–5 star picker built on native radio buttons, so it works with
 * the keyboard (arrow keys), screen readers, and plain form submission.
 */
export function StarInput({
  defaultValue,
  error,
}: {
  defaultValue?: number;
  error?: string[];
}) {
  const t = useT();
  const initial = defaultValue && defaultValue >= 1 && defaultValue <= 5 ? defaultValue : 0;
  const [value, setValue] = useState(initial);
  const [hover, setHover] = useState(0);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  const errorId = useId();
  const shown = hover || value;

  // Keep the stars in sync when the surrounding form is reset.
  useEffect(() => {
    const form = fieldsetRef.current?.form;
    if (!form) return;
    const onReset = () => setValue(initial);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  return (
    <fieldset
      ref={fieldsetRef}
      aria-describedby={error?.length ? errorId : undefined}
      aria-invalid={error?.length ? true : undefined}
    >
      <legend className="text-sm font-medium text-ink">{t("common.starInput.legend")}</legend>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer p-0.5"
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name="rating"
                value={n}
                defaultChecked={initial === n}
                onChange={() => setValue(n)}
                className="peer sr-only"
              />
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cx(
                  "size-9 rounded-md fill-current transition-transform peer-focus-visible:outline-2 peer-focus-visible:outline-focus",
                  n <= shown ? "text-star" : "text-star-empty",
                  hover === n && "scale-110",
                )}
              >
                <path d={STAR_PATH} />
              </svg>
              <span className="sr-only">
                {t("common.starInput.option", { count: n, label: t(LABELS[n - 1]) })}
              </span>
            </label>
          ))}
        </div>
        <span className="text-sm font-medium text-muted" aria-hidden>
          {shown ? t(LABELS[shown - 1]) : t("common.starInput.hint")}
        </span>
      </div>
      {error?.length ? (
        <p id={errorId} className="mt-1.5 text-sm text-danger">
          {error[0]}
        </p>
      ) : null}
    </fieldset>
  );
}
