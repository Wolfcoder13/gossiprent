"use client";

import { useActionState, useRef } from "react";
import { updatePropertyLandlord } from "@/app/actions/properties";
import { FormMessage, SubmitButton, useFocusAfterSubmit } from "@/components/form";
import { idleFormState } from "@/lib/validation";

/**
 * "I manage this property" / "Not my property". One component for both, so
 * the result message stays on screen when the button swaps after the action.
 */
export function LandlordActions({
  propertyId,
  mode,
}: {
  propertyId: string;
  mode: "claim" | "unlink" | null;
}) {
  const [state, formAction] = useActionState(updatePropertyLandlord, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="contents"
      onSubmit={(event) => {
        const unlinking = mode === "unlink";
        if (
          unlinking &&
          !window.confirm(
            "Remove yourself as the landlord of this property? The listing and its reviews stay on GossipRent.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      {mode && <input type="hidden" name="intent" value={mode} />}
      {mode && (
        <SubmitButton variant="secondary" pendingLabel="Saving…" className="px-3! py-1.5! text-xs">
          {mode === "claim" ? "I manage this property" : "Not my property"}
        </SubmitButton>
      )}
      {state.status !== "idle" && (
        <div className="basis-full">
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
