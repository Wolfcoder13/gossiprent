"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cx } from "./ui";

const LABELS = ["", "Terrible", "Poor", "Okay", "Good", "Excellent"];
const STAR_PATH =
  "M12 2.5l2.94 6.11 6.56.84-4.82 4.6 1.2 6.55L12 17.4l-5.88 3.2 1.2-6.55-4.82-4.6 6.56-.84L12 2.5z";

/**
 * Accessible 1–5 star picker built on native radio buttons, so it works with
 * the keyboard (arrow keys), screen readers, and plain form submission.
 */
export function StarInput({
  name = "rating",
  label = "Your rating",
  defaultValue,
  error,
}: {
  name?: string;
  label?: string;
  defaultValue?: number;
  error?: string[];
}) {
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
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <div className="mt-1.5 flex items-center gap-3">
        <div className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer p-0.5"
              onMouseEnter={() => setHover(n)}
            >
              <input
                type="radio"
                name={name}
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
                {n} {n === 1 ? "star" : "stars"} ({LABELS[n]})
              </span>
            </label>
          ))}
        </div>
        <span className="text-sm font-medium text-muted" aria-hidden>
          {shown ? LABELS[shown] : "Tap a star"}
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
