"use client";

import { deleteAccount } from "@/app/actions/account";
import { SubmitButton } from "@/components/form";

export function DeleteAccount() {
  return (
    <form
      action={deleteAccount}
      onSubmit={(event) => {
        const ok = window.confirm(
          "Close your account? Your login and the reviews you wrote will be permanently deleted.",
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="delete" />
      <SubmitButton variant="danger" pendingLabel="Closing…">
        Close my account
      </SubmitButton>
    </form>
  );
}
