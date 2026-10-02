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
