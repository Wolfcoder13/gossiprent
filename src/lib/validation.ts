import { z } from "zod";

/** Trimmed text where blank means "not provided" (stored as null). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => value || null);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

/** A checkbox: present ("on") when ticked, missing when not. */
const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on" || value === "true");

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(80, "Name must be 80 characters or fewer.");

const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const signupSchema = z
  .object({
    name,
    email,
    password,
    isRenter: checkbox,
    isLandlord: checkbox,
    city: optionalText(80, "City"),
  })
  .refine((data) => data.isRenter || data.isLandlord, {
    path: ["roles"],
    message: "Choose at least one: renter, landlord, or both.",
  });

export const roleChangeSchema = z.object({
  role: z.enum(["landlord", "renter"]),
  change: z.enum(["add", "remove"]),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const profileSchema = z.object({
  name,
  city: optionalText(80, "City"),
  bio: optionalText(500, "Bio"),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: password,
    confirmPassword: z.string().max(128, "Password must be 128 characters or fewer."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The new passwords don't match.",
  });

export const reviewSchema = z.object({
  kind: z.enum(["landlord", "renter", "property"]),
  subjectId: z.uuid("That review target doesn't exist."),
  rating: z.coerce
    // Without this, a missing rating shows zod's "expected number, received NaN".
    .number({ error: "Pick a star rating from 1 to 5." })
    .int("Pick a star rating.")
    .min(1, "Pick a star rating from 1 to 5.")
    .max(5, "Pick a star rating from 1 to 5."),
  title: z
    .string()
    .trim()
    .min(3, "Title must be at least 3 characters.")
    .max(120, "Title must be 120 characters or fewer."),
  body: z
    .string()
    .trim()
    .min(20, "Your review must be at least 20 characters.")
    .max(5000, "Your review must be 5,000 characters or fewer."),
});

export const propertySchema = z.object({
  address: z
    .string()
    .trim()
    .min(3, "Enter the street address.")
    .max(200, "Address must be 200 characters or fewer."),
  unit: optionalText(30, "Unit"),
  city: z
    .string()
    .trim()
    .min(2, "Enter the city.")
    .max(80, "City must be 80 characters or fewer."),
  region: z
    .string()
    .trim()
    .min(2, "Enter the state, province, or region.")
    .max(80, "State/region must be 80 characters or fewer."),
  postalCode: optionalText(20, "Postal code"),
  description: optionalText(300, "Description"),
  // People who are both a landlord and a renter say which applies here.
  relation: z.enum(["own", "rent"], { error: "Choose whether you own or rent this place." }).optional(),
  // "" = not on GossipRent / not sure, "me" = the person adding it.
  // Missing (undefined) means the form had no landlord field at all.
  landlordId: z
    .union([z.literal(""), z.literal("me"), z.uuid("Choose a landlord from the list.")])
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
});

export type FieldErrors = Partial<Record<string, string[]>>;

/** Shared shape returned by every form Server Action. */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echo of the submitted values so the form can be re-filled after an error. */
  values?: Record<string, string>;
  /** Optional follow-up link shown with the message. */
  link?: { href: string; label: string };
};

export const idleFormState: FormState = { status: "idle" };

/**
 * Postgres can't store or compare text containing NUL characters (it errors),
 * and they're never meaningful in this app, so drop them from all user input.
 */
export function stripNul(value: string): string {
  return value.includes("\u0000") ? value.replaceAll("\u0000", "") : value;
}

/** Plain string values from a FormData, skipping files and anything password-like. */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !/password/i.test(key)) {
      values[key] = stripNul(value);
    }
  }
  return values;
}

/** Parse a FormData against a schema, returning field errors on failure. */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: FormData,
):
  | { success: true; data: z.output<T> }
  | { success: false; state: FormState } {
  const input: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    input[key] = typeof value === "string" ? stripNul(value) : value;
  }
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    state: {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: z.flattenError(result.error).fieldErrors as FieldErrors,
      values: formValues(formData),
    },
  };
}

/**
 * Only allow redirects to paths on this site (e.g. "/landlords/123"), never to
 * another origin like "//evil.example" or "https://evil.example".
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  // Browsers treat a backslash like "/" and silently drop tabs and newlines, so
  // those could still turn the path into a protocol-relative URL. Reject them.
  if (/[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) {
    return fallback;
  }
  // Resolve dot-segments the way the browser will ("/.//evil.example" becomes
  // "//evil.example") and percent-encode non-ASCII so the result is also a
  // valid redirect header. Then re-check what's left.
  let url: URL;
  try {
    url = new URL(value, "http://localhost");
  } catch {
    return fallback;
  }
  const path = url.pathname + url.search + url.hash;
  if (url.origin !== "http://localhost" || path.startsWith("//")) return fallback;
  return path;
}
