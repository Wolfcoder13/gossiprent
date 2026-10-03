/**
 * The contract between forms and their Server Actions. Client-safe (no
 * server or zod imports), so form components can use it freely.
 */

/** Shared shape returned by every form Server Action. */
export type FormState = {
  status: "idle" | "error" | "success";
  /** Already translated. */
  message?: string;
  /** Already translated, per field. */
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Echo of the submitted values so the form can be re-filled after an error. */
  values?: Record<string, string>;
  /** Optional follow-up link shown with the message. */
  link?: { href: string; label: string };
};

export const idleFormState: FormState = { status: "idle" };

/**
 * Length limits (in characters, after trimming). The schemas in
 * src/lib/validation.ts enforce them and their messages quote them; forms use
 * them for `maxLength` so the browser stops at the same place.
 */
export const LIMITS = {
  name: { min: 2, max: 80 },
  email: { max: 254 },
  password: { min: 8, max: 128 },
  city: { max: 80 },
  bio: { max: 500 },
  title: { min: 3, max: 120 },
  body: { min: 20, max: 5000 },
  address: { min: 3, max: 200 },
  unit: { max: 30 },
  description: { max: 300 },
  reportDetails: { max: 2000 },
} as const;
