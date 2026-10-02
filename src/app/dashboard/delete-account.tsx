"use client";

import { deleteAccount } from "@/app/actions/account";
import { SubmitButton } from "@/components/form";

export function DeleteAccount() {
  return (
    <form
      action={deleteAccount}
      onSubmit={(event) => {
        const ok = window.confirm(
          "Delete your account? Your reviews, and reviews written about you, will be permanently removed.",
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="delete" />
      <SubmitButton variant="danger" pendingLabel="Deleting…">
        Delete my account
      </SubmitButton>
    </form>
  );
}
