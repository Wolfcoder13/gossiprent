"use client";

import { deleteAccount } from "@/app/actions/account";
import { SubmitButton } from "@/components/form";
import { useT } from "@/i18n/client";

export function DeleteAccount() {
  const t = useT();
  return (
    <form
      action={deleteAccount}
      onSubmit={(event) => {
        if (!window.confirm(t("account.close.confirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="confirm" value="delete" />
      <SubmitButton variant="danger" pendingLabel={t("account.close.pending")}>
        {t("account.close.button")}
      </SubmitButton>
    </form>
  );
}
