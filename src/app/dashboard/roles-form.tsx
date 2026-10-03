"use client";

import { useActionState, useRef } from "react";
import { changeRole } from "@/app/actions/account";
import { FormMessage, SubmitButton, useFocusAfterSubmit } from "@/components/form";
import { RoleBadge } from "@/components/ui";
import type { UserRole } from "@/db/schema";
import { useT } from "@/i18n/client";
import { idleFormState } from "@/lib/form-state";

// Message keys per role (whole sentences, never built from the role's name).
const ROLE_COPY = {
  landlord: {
    add: "account.roles.add.landlord",
    remove: "account.roles.remove.landlord",
    confirmRemove: "account.roles.confirmRemove.landlord",
    kept: "account.roles.kept.landlord",
    notA: "account.roles.notA.landlord",
  },
  renter: {
    add: "account.roles.add.renter",
    remove: "account.roles.remove.renter",
    confirmRemove: "account.roles.confirmRemove.renter",
    kept: "account.roles.kept.renter",
    notA: "account.roles.notA.renter",
  },
} as const satisfies Record<UserRole, Record<string, string>>;

/**
 * The account's roles, with a button to add a missing one and, for someone
 * with both, to remove one nobody has reviewed them in.
 */
export function RolesForm({
  isLandlord,
  isRenter,
  reviewedAs,
  next,
}: {
  isLandlord: boolean;
  isRenter: boolean;
  /** Roles someone has reviewed them in (those can't be removed). */
  reviewedAs: UserRole[];
  /** Page to offer going back to after adding a role (e.g. the review they were writing). */
  next?: string;
}) {
  const t = useT();
  const [state, formAction] = useActionState(changeRole, idleFormState);
  const ref = useRef<HTMLDivElement>(null);
  useFocusAfterSubmit(ref, state);
  const has: Record<UserRole, boolean> = { landlord: isLandlord, renter: isRenter };
  const both = isLandlord && isRenter;
  // Roles they have first (landlord first, as everywhere else), then the one they could add.
  const order: UserRole[] = ["landlord", "renter"];
  order.sort((a, b) => Number(has[b]) - Number(has[a]));

  return (
    <div ref={ref} className="space-y-4">
      <FormMessage state={state} />
      <ul className="space-y-3">
        {order.map((role) => (
          <li key={role} className="flex flex-wrap items-center justify-between gap-2">
            {has[role] ? (
              <RoleBadge role={role} />
            ) : (
              <span className="text-sm text-muted">{t(ROLE_COPY[role].notA)}</span>
            )}
            {!has[role] ? (
              <form action={formAction}>
                <input type="hidden" name="role" value={role} />
                <input type="hidden" name="change" value="add" />
                {next && <input type="hidden" name="next" value={next} />}
                <SubmitButton
                  variant="secondary"
                  pendingLabel={t("account.roles.saving")}
                  className="px-3! py-1.5! text-xs"
                >
                  {t(ROLE_COPY[role].add)}
                </SubmitButton>
              </form>
            ) : both && reviewedAs.includes(role) ? (
              <span className="text-xs text-muted">{t(ROLE_COPY[role].kept)}</span>
            ) : both ? (
              <form
                action={formAction}
                onSubmit={(event) => {
                  if (!window.confirm(t(ROLE_COPY[role].confirmRemove))) event.preventDefault();
                }}
              >
                <input type="hidden" name="role" value={role} />
                <input type="hidden" name="change" value="remove" />
                <SubmitButton
                  variant="secondary"
                  pendingLabel={t("account.roles.saving")}
                  className="px-3! py-1.5! text-xs"
                >
                  {t(ROLE_COPY[role].remove)}
                </SubmitButton>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
