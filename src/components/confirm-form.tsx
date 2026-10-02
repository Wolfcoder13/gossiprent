"use client";

import type { ReactNode } from "react";

/** A form that asks for confirmation before running its Server Action. */
export function ConfirmForm({
  action,
  confirmMessage,
  fields,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  confirmMessage: string;
  fields: Record<string, string>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
