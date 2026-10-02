"use client";

import { useActionState, useRef } from "react";
import { changeRole } from "@/app/actions/account";
import { FormMessage, SubmitButton, useFocusAfterSubmit } from "@/components/form";
import { RoleBadge } from "@/components/ui";
import type { UserRole } from "@/db/schema";
import { idleFormState } from "@/lib/validation";

const ROLE_COPY: Record<UserRole, { add: string; remove: string; confirmRemove: string; kept: string }> = {
  landlord: {
    add: "I'm also a landlord",
    remove: "Remove landlord role",
    confirmRemove:
      "Remove the landlord role? Your properties will no longer be linked to you. You can add the role back any time.",
    kept: "Renters have reviewed you, so this role stays.",
  },
  renter: {
    add: "I'm also a renter",
    remove: "Remove renter role",
    confirmRemove: "Remove the renter role? You can add it back any time.",
    kept: "Landlords have reviewed you, so this role stays.",
  },
};

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
              <span className="text-sm text-muted">Not a {role}</span>
            )}
            {!has[role] ? (
              <form action={formAction}>
                <input type="hidden" name="role" value={role} />
                <input type="hidden" name="change" value="add" />
                {next && <input type="hidden" name="next" value={next} />}
                <SubmitButton variant="secondary" pendingLabel="Saving…" className="px-3! py-1.5! text-xs">
                  {ROLE_COPY[role].add}
                </SubmitButton>
              </form>
            ) : both && reviewedAs.includes(role) ? (
              <span className="text-xs text-muted">{ROLE_COPY[role].kept}</span>
            ) : both ? (
              <form
                action={formAction}
                onSubmit={(event) => {
                  if (!window.confirm(ROLE_COPY[role].confirmRemove)) event.preventDefault();
                }}
              >
                <input type="hidden" name="role" value={role} />
                <input type="hidden" name="change" value="remove" />
                <SubmitButton variant="secondary" pendingLabel="Saving…" className="px-3! py-1.5! text-xs">
                  {ROLE_COPY[role].remove}
                </SubmitButton>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
