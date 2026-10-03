/**
 * Form schemas. Error messages are dictionary keys (validation.*), which
 * parseForm translates for the visitor; length messages get the limit that
 * failed as {count}.
 */

import { z } from "zod";
import type { ReportReason, ReportTarget, ReviewKind } from "@/db/schema";
import type { Messages } from "@/i18n/messages";
import type { Leaves, Translator } from "@/i18n/types";
import { LIMITS, type FormState } from "./form-state";
import { containsKennitala, parseKennitalaInput } from "./kennitala";
import { isHomePostcode } from "./postcodes";
import { normalizeMultilineText, normalizeText, normalizeUnit } from "./text";

type ValidationKey = `validation.${Leaves<Messages["validation"]>}`;

const noKennitala = (value: string) => !containsKennitala(value);

/**
 * Multi-line free text (reviews, bios, descriptions): NFC, trimmed, line
 * breaks as "\n" (so a browser's CRLF counts as one character, like the
 * textarea's maxLength does), no other control characters, at most `max`
 * characters, and never containing a kennitala.
 */
export function freeText(max: number, tooLong: ValidationKey = "validation.tooLong") {
  return z
    .string()
    .overwrite(normalizeMultilineText)
    .max(max, tooLong)
    .refine(noKennitala, "validation.noKennitalaInText");
}

/** One line of text: like freeText, with runs of whitespace (line breaks too) collapsed to one space. */
function textLine(max: number, tooLong: ValidationKey) {
  return z
    .string()
    .overwrite(normalizeText)
    .max(max, tooLong)
    .refine(noKennitala, "validation.noKennitalaInText");
}

/** Blank (empty, or only spaces and control characters) or missing means "not given": null. */
export function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === undefined || (typeof value === "string" && normalizeText(value) === "") ? null : value),
    schema.nullable(),
  );
}

/** A checkbox: present ("on") when ticked, missing when not. */
export const checkbox = z
  .string()
  .optional()
  .transform((value) => value === "on");

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.email.max, "validation.email.tooLong")
  .pipe(z.email("validation.email.invalid"));

const password = z
  .string()
  .min(LIMITS.password.min, "validation.password.tooShort")
  .max(LIMITS.password.max, "validation.password.tooLong");

/**
 * A kennitala however it was typed ("010130-2989", "010130 2989", "kt. 0101302989")
 * → its 10 digits. Rejects anything that can't be a real one (see parseKennitalaInput).
 */
export const kennitalaField = z
  .string({ error: "validation.kennitala.required" })
  .trim()
  .min(1, "validation.kennitala.required")
  .transform((value, ctx) => {
    const parsed = parseKennitalaInput(value);
    if (parsed) return parsed.value;
    ctx.issues.push({ code: "custom", message: "validation.kennitala.invalid", input: value });
    return z.NEVER;
  });

/** Like kennitalaField, but blank or missing → null. */
export const optionalKennitalaField = optional(kennitalaField);

// Names: letters in any script (with combining marks), spaces, hyphens,
// apostrophes and periods, and at least one letter. Companies may also use
// digits and "&". Empty passes here so a blank name only gets "too short".
const PERSON_NAME = /^$|^(?=.*\p{L})[\p{L}\p{M} '’.-]+$/u;
const COMPANY_NAME = /^$|^(?=.*\p{L})[\p{L}\p{M}0-9& '’.-]+$/u;
const WEB_ADDRESS = /https?:|www\.|[\p{L}\p{N}]\.(?:is|com|net|org|io|eu|co|uk|de|dk|no|se|info|biz)(?![\p{L}\p{N}])/iu;

function nameField(chars: RegExp, charsMessage: ValidationKey) {
  return z
    .string()
    .overwrite(normalizeText)
    .min(LIMITS.name.min, "validation.name.tooShort")
    .max(LIMITS.name.max, "validation.name.tooLong")
    .regex(chars, charsMessage)
    .refine((value) => !WEB_ADDRESS.test(value), "validation.name.noLink")
    .refine(noKennitala, "validation.noKennitalaInText");
}

/** A person's name (accounts are always persons). */
export const personName = nameField(PERSON_NAME, "validation.name.personChars");

/** The name typed for someone else, before we know if their kennitala is a person's or a company's. */
export const personOrCompanyName = nameField(COMPANY_NAME, "validation.name.companyChars");

/**
 * Whether a name that passed personOrCompanyName also meets the rules for a
 * person (no digits or "&"). For use once the kennitala shows it's a person.
 */
export function isPersonName(name: string): boolean {
  return PERSON_NAME.test(normalizeText(name));
}

/** A postcode from the list (HOME_POSTCODES) → its number, e.g. "101" → 101. */
export const postalCodeField = z
  .string({ error: "validation.postalCode.required" })
  .trim()
  .min(1, "validation.postalCode.required")
  .transform((value, ctx) => {
    const code = Number(value);
    if (/^\d{3}$/.test(value) && isHomePostcode(code)) return code;
    ctx.issues.push({ code: "custom", message: "validation.postalCode.invalid", input: value });
    return z.NEVER;
  });

const city = optional(textLine(LIMITS.city.max, "validation.city.tooLong"));

export const signupSchema = z
  .object({
    kennitala: kennitalaField,
    name: personName,
    email: emailField,
    password,
    isRenter: checkbox,
    isLandlord: checkbox,
    city,
  })
  .refine((data) => data.isRenter || data.isLandlord, {
    path: ["roles"],
    message: "validation.roles.required",
    // Also when another field (e.g. the kennitala) failed, so every problem shows at once.
    when: () => true,
  });

export const roleChangeSchema = z.object({
  role: z.enum(["landlord", "renter"]),
  change: z.enum(["add", "remove"]),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "validation.password.required").max(LIMITS.password.max),
});

export const profileSchema = z.object({
  name: personName,
  city,
  bio: optional(freeText(LIMITS.bio.max, "validation.bio.tooLong")),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "validation.password.currentRequired").max(LIMITS.password.max),
    newPassword: password,
    confirmPassword: z.string().max(LIMITS.password.max, "validation.password.tooLong"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "validation.password.mismatch",
  });

const REVIEW_KINDS = ["landlord", "renter", "property"] as const satisfies readonly ReviewKind[];

const rating = z.coerce
  // Without this, a missing rating shows zod's "expected number, received NaN".
  .number({ error: "validation.rating.required" })
  .int("validation.rating.whole")
  .min(1, "validation.rating.required")
  .max(5, "validation.rating.required");

const title = textLine(LIMITS.title.max, "validation.title.tooLong").min(LIMITS.title.min, "validation.title.tooShort");

const body = freeText(LIMITS.body.max, "validation.body.tooLong").min(LIMITS.body.min, "validation.body.tooShort");

/** The review form on a profile or property page. */
export const reviewSchema = z.object({
  kind: z.enum(REVIEW_KINDS),
  subjectId: z.uuid("validation.review.subject"),
  // Only for a first review of a person: proves the reviewer knows who they are.
  subjectKennitala: optionalKennitalaField,
  rating,
  title,
  body,
});

/**
 * Forms with a "check" button next to a kennitala and a main "save" button:
 * a submission without an intent saves.
 */
function savesByDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (input) =>
      typeof input === "object" && input !== null && (input as { intent?: unknown }).intent === undefined
        ? { ...input, intent: "save" }
        : input,
    schema,
  );
}

const personKind = z.enum(["landlord", "renter"], { error: "validation.review.kind" });

/**
 * /reviews/new. intent "check" looks up the kennitala (only kind and
 * subjectKennitala are needed); intent "save" posts the review. subjectName
 * and confirmNew are only required when the kennitala is new to GossipRent,
 * which only the action can tell.
 */
export const reviewWizardSchema = savesByDefault(
  z.discriminatedUnion("intent", [
    z.object({ intent: z.literal("check"), kind: personKind, subjectKennitala: kennitalaField }),
    z.object({
      intent: z.literal("save"),
      kind: personKind,
      subjectKennitala: kennitalaField,
      subjectName: optional(personOrCompanyName),
      confirmNew: checkbox,
      rating,
      title,
      body,
    }),
  ]),
);

/**
 * Add a property. intent "check" only reports who landlordKennitala belongs
 * to; intent "save" adds the property. landlordName and confirmNewLandlord
 * are only required when the kennitala is new, which only the action can tell.
 */
export const propertySchema = savesByDefault(
  z.discriminatedUnion("intent", [
    z.object({ intent: z.literal("check"), landlordKennitala: kennitalaField }),
    z.object({
      intent: z.literal("save"),
      address: textLine(LIMITS.address.max, "validation.address.tooLong").min(
        LIMITS.address.min,
        "validation.address.required",
      ),
      // Stored without "íbúð", "apt." or "#" (normalizeUnit): "íbúð-0201" → "0201", "apt.B" → "B".
      unit: optional(
        textLine(LIMITS.unit.max, "validation.unit.tooLong").overwrite((unit) => normalizeUnit(unit) ?? ""),
      ).transform((unit) => unit || null),
      postalCode: postalCodeField,
      description: optional(freeText(LIMITS.description.max, "validation.description.tooLong")),
      // People who are both a landlord and a renter say which applies here.
      relation: z.enum(["own", "rent"], { error: "validation.relation.required" }).optional(),
      landlordKennitala: optionalKennitalaField,
      landlordName: optional(personOrCompanyName),
      confirmNewLandlord: checkbox,
    }),
  ]),
);

/** Look up a kennitala (home page and /search). */
export const lookupSchema = z.object({ kennitala: kennitalaField });

export const REPORT_TARGETS = ["review", "profile", "property", "account"] as const satisfies readonly ReportTarget[];

export const REPORT_REASONS = [
  "wrong_person",
  "wrong_name",
  "false_or_abusive",
  "personal_data",
  "identity_claimed",
  "other",
] as const satisfies readonly ReportReason[];

/**
 * /report. `id` is required except for target "account" (always null there).
 * The details may contain a kennitala: someone reporting that their identity
 * was claimed has to say whose. Reports are only read by the operator (in a
 * terminal, so no control characters are stored: normalizeMultilineText).
 */
export const reportSchema = z
  .object({
    target: z.enum(REPORT_TARGETS, { error: "validation.report.target" }),
    id: optional(z.uuid("validation.report.target")),
    reason: z.enum(REPORT_REASONS, { error: "validation.report.reason" }),
    details: z
      .string()
      .overwrite(normalizeMultilineText)
      .min(1, "validation.report.detailsRequired")
      .max(LIMITS.reportDetails.max, "validation.tooLong"),
    contactEmail: optional(emailField),
  })
  .refine((report) => report.target === "account" || report.id !== null, {
    path: ["id"],
    message: "validation.report.target",
  })
  .transform((report) => (report.target === "account" ? { ...report, id: null } : report));

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

/** `t` for a key that's only known at runtime (one that `t.has` accepted). */
type DynamicT = (key: string, params?: Record<string, number>) => string;

/** A zod issue in the visitor's language. Unknown messages become validation.invalid. */
function issueMessage(issue: z.core.$ZodIssue, t: Translator<Messages>): string {
  const limit = issue.code === "too_small" ? issue.minimum : issue.code === "too_big" ? issue.maximum : undefined;
  const key = t.has(issue.message) ? issue.message : "validation.invalid";
  return (t as unknown as DynamicT)(key, limit === undefined ? undefined : { count: Number(limit) });
}

/**
 * Parse a FormData against a schema. On failure, returns an error state with
 * translated field errors (issues without a field become the banner).
 */
export function parseForm<T extends z.ZodType>(
  schema: T,
  formData: FormData,
  t: Translator<Messages>,
):
  | { success: true; data: z.output<T> }
  | { success: false; state: FormState } {
  const input: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    input[key] = typeof value === "string" ? stripNul(value) : value;
  }
  const result = schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };

  const fieldErrors: Partial<Record<string, string[]>> = {};
  let formError: string | undefined;
  for (const issue of result.error.issues) {
    const message = issueMessage(issue, t);
    const field = issue.path[0];
    if (field === undefined) formError ??= message;
    else (fieldErrors[String(field)] ??= []).push(message);
  }
  return {
    success: false,
    state: {
      status: "error",
      message: formError ?? t("validation.fixHighlighted"),
      fieldErrors,
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
