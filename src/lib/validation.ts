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

export const roleSchema = z.enum(["landlord", "renter"], {
  error: "Choose whether you're a landlord or a renter.",
});

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(80, "Name must be 80 characters or fewer."),
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer."),
  role: roleSchema,
  city: optionalText(80, "City"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
});

export const profileSchema = z.object({
  name: signupSchema.shape.name,
  city: optionalText(80, "City"),
  bio: optionalText(500, "Bio"),
});

export const reviewSchema = z.object({
  kind: z.enum(["landlord", "renter", "property"]),
  subjectId: z.uuid("That review target doesn't exist."),
  rating: z.coerce
    .number()
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
  landlordId: z
    .union([z.literal(""), z.uuid("Choose a landlord from the list.")])
    .optional()
    .transform((value) => value || null),
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

/** Plain string values from a FormData, skipping files and passwords. */
export function formValues(
  formData: FormData,
  omit: string[] = ["password"],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !omit.includes(key)) {
      values[key] = value;
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
  const result = schema.safeParse(Object.fromEntries(formData.entries()));
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
  return value;
}
