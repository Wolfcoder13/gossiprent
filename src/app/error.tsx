"use client";

import { useEffect } from "react";
import { buttonStyles, cx } from "@/components/ui";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Re-fetches the failed segment from the server and re-renders it. */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-3 text-muted">
        Sorry about that. Please try again in a moment.
        {error.digest && <span className="mt-2 block text-xs">Error reference: {error.digest}</span>}
      </p>
      <button type="button" onClick={() => retry()} className={cx(buttonStyles.base, buttonStyles.primary, "mt-8")}>
        Try again
      </button>
    </div>
  );
}
