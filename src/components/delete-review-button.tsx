"use client";

import { deleteReview } from "@/app/actions/reviews";
import { useT } from "@/i18n/client";
import { SubmitButton } from "./form";

export function DeleteReviewButton({ reviewId }: { reviewId: string }) {
  const t = useT();
  return (
    <form
      action={deleteReview}
      onSubmit={(event) => {
        if (!window.confirm(t("common.deleteReview.confirm"))) {
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
      <SubmitButton
        variant="danger"
        pendingLabel={t("common.deleteReview.pending")}
        className="px-3! py-1! text-xs"
      >
        {t("common.deleteReview.button")}
      </SubmitButton>
    </form>
  );
}
