"use client";

import { deleteReview } from "@/app/actions/reviews";
import { SubmitButton } from "./form";

export function DeleteReviewButton({ reviewId }: { reviewId: string }) {
  return (
    <form
      action={deleteReview}
      onSubmit={(event) => {
        if (!window.confirm("Delete this review? This can't be undone.")) {
          event.preventDefault();
          return;
        }
        // This card is about to disappear, which would drop keyboard focus to
        // the top of the page. Keep it on the section's heading (whose count
        // updates) instead.
        const heading = event.currentTarget.closest("section")?.querySelector<HTMLElement>("h2");
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      }}
    >
      <input type="hidden" name="reviewId" value={reviewId} />
      <SubmitButton variant="danger" pendingLabel="Deleting…" className="px-3! py-1! text-xs">
        Delete
      </SubmitButton>
    </form>
  );
}
