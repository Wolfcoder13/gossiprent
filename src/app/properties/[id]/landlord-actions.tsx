"use client";

import { useActionState, useRef, useState } from "react";
import { updatePropertyLandlord, type PropertyFormState } from "@/app/actions/properties";
import { FormMessage, SubmitButton, useFocusAfterSubmit } from "@/components/form";
import { useT } from "@/i18n/client";
import { idleFormState } from "@/lib/form-state";
import { LandlordFields } from "../landlord-fields";

/**
 * "I manage this property" / "Not my property". One component for both, so
 * the result message stays on screen when the button swaps after the action.
 */
export function LandlordActions({ propertyId, mode }: { propertyId: string; mode: "claim" | "unlink" | null }) {
  const t = useT();
  const [state, formAction] = useActionState<PropertyFormState, FormData>(updatePropertyLandlord, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusAfterSubmit(formRef, state);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="contents"
      onSubmit={(event) => {
        if (mode === "unlink" && !window.confirm(t("properties.page.unlinkConfirm"))) event.preventDefault();
      }}
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      {mode && <input type="hidden" name="intent" value={mode} />}
      {mode && (
        <SubmitButton variant="secondary" pendingLabel={t("properties.page.saving")} className="px-3! py-1.5! text-xs">
          {mode === "claim" ? t("properties.page.claim") : t("properties.page.unlink")}
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

/**
 * For the person who added the property: link its landlord by kennitala,
 * change it, or (left empty) remove it, while the landlord has no account.
 * Rendered for the creator even when it can't be edited (`editable` false),
 * so the result of the last change stays on screen.
 */
export function RelinkLandlord({
  propertyId,
  hasLandlord,
  editable,
}: {
  propertyId: string;
  hasLandlord: boolean;
  editable: boolean;
}) {
  const t = useT();
  const [state, formAction] = useActionState<PropertyFormState, FormData>(updatePropertyLandlord, idleFormState);
  // The message and the form: after saving, focus goes to the message (the form closes).
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusAfterSubmit(containerRef, state);
  // Every answer re-creates the form (re-filled from state.values): open while
  // there's something to show in it (a check, or an error), closed after saving.
  const [answers, setAnswers] = useState({ state, count: 0 });
  if (answers.state !== state) setAnswers({ state, count: answers.count + 1 });
  const open = state.status === "error" || Boolean(state.landlord);

  if (!editable) {
    return state.status === "success" ? (
      <div ref={containerRef} className="basis-full">
        <FormMessage state={state} />
      </div>
    ) : null;
  }
  return (
    <div ref={containerRef} className="basis-full space-y-3">
      {state.status === "success" && <FormMessage state={state} />}
      <details key={answers.count} open={open || undefined}>
        <summary className="cursor-pointer text-sm font-semibold text-brand hover:underline">
          {hasLandlord ? t("properties.relink.change") : t("properties.relink.link")}
        </summary>
        <form action={formAction} className="mt-3 space-y-4" noValidate>
          {/* Enter in a text field presses the first submit button: make that "Save landlord", not "Check". */}
          <button type="submit" name="intent" value="relink" tabIndex={-1} aria-hidden className="sr-only">
            {t("properties.relink.save")}
          </button>
          <input type="hidden" name="propertyId" value={propertyId} />
          <p className="text-sm text-muted">{t("properties.relink.intro")}</p>
          {state.status === "error" && <FormMessage state={state} />}
          <LandlordFields state={state} />
          <SubmitButton name="intent" value="relink" pendingLabel={t("properties.relink.saving")}>
            {t("properties.relink.save")}
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
