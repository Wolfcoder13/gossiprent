"use server";

import { and, eq, isNotNull, TransactionRollbackError } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode, type Transaction } from "@/db";
import { properties, reviews, users, type ReviewKind, type UserRole } from "@/db/schema";
import { getFormat, getT, type T } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  clientIp,
  consumeAttempt,
  kennitalaCheckLimits,
  kennitalaMismatchLimits,
  newProfileLimits,
  newReviewLimits,
  type RateLimit,
} from "@/lib/auth/rate-limit";
import { isUuid } from "@/lib/data";
import { formatKennitala, isAdultKennitala, parseKennitalaInput, type ParsedKennitala } from "@/lib/kennitala";
import {
  ensurePerson,
  findPersonByKennitala,
  grantRoleById,
  grantRoleByKennitala,
  reconcileProfiles,
  type Person,
} from "@/lib/people";
import { subjectPath } from "@/lib/paths";
import { hasRole, reviewerRole } from "@/lib/roles";
import { LIMITS, type FormState } from "@/lib/form-state";
import { formValues, isPersonName, parseForm, reviewSchema, reviewWizardSchema } from "@/lib/validation";

/*
 * Writing and deleting reviews (docs/iceland-spec.md §5).
 *
 * A review of a landlord or renter is tied to a kennitala the author typed, so
 * a review can't land on a namesake's page: the profile-page form checks the
 * number against the profile (grantRoleById), and /reviews/new looks it up
 * and, if nobody has it yet, creates a profile without an account.
 *
 * Every kennitala check is rate limited (src/lib/auth/rate-limit.ts). Limits
 * are counted before the transaction (the embedded database runs one
 * transaction at a time, so nothing else may query while one is open) and
 * released afterwards when they turned out not to apply: an edit, a match on
 * the profile page, or a refusal before any lookup.
 */

type PersonKind = UserRole;

/** The two-step form at /reviews/new. `step` is the step to show next. */
export type WizardState = FormState & {
  step: "kennitala" | "review";
  /** Who the kennitala belongs to (step "review"). Only ever sent to the author who typed it. */
  subject?: WizardSubject;
};

export type WizardSubject = {
  /** Null: nobody has this kennitala yet. */
  id: string | null;
  name: string | null;
  hasAccount: boolean;
  isCompany: boolean;
  /** "DDMMYY-NNNN", as the author typed it (their own form echo). */
  formattedKennitala: string;
  /** A person's birth date, formatted for the visitor; null for companies and temporary numbers. */
  birthDate: string | null;
};

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/** Limits a review may need; each is counted once and released if it didn't apply. */
type LimitName = "check" | "newReview" | "newProfile";
type Counted = Record<LimitName, boolean>;

class HeldLimits {
  private readonly held = new Map<LimitName, () => Promise<void>>();

  constructor(private readonly limitsFor: Record<LimitName, () => Promise<RateLimit[]>>) {}

  counted(): Counted {
    return { check: this.held.has("check"), newReview: this.held.has("newReview"), newProfile: this.held.has("newProfile") };
  }

  /** Count one attempt against `name`'s limits. False if over a limit (then nothing is held for it). */
  async consume(name: LimitName): Promise<boolean> {
    if (this.held.has(name)) return true;
    const attempt = await consumeAttempt(await this.limitsFor[name]());
    if (attempt.limited) return false;
    this.held.set(name, attempt.release);
    return true;
  }

  /** Un-count these attempts (they didn't apply after all). */
  async release(...names: LimitName[]): Promise<void> {
    for (const name of names) {
      await this.held.get(name)?.();
      this.held.delete(name);
    }
  }
}

function limitsForUser(userId: string, subjectId: string | null): Record<LimitName, () => Promise<RateLimit[]>> {
  return {
    // On the profile page a check also counts against the profile, so nobody can
    // guess its number from many accounts; a match releases both.
    check: async () => [
      ...kennitalaCheckLimits(userId, await clientIp()),
      ...(subjectId ? kennitalaMismatchLimits(subjectId) : []),
    ],
    newReview: async () => newReviewLimits(userId),
    newProfile: async () => newProfileLimits(userId),
  };
}

// ---------------------------------------------------------------------------
// The shared transaction
// ---------------------------------------------------------------------------

/** Why a review was refused; the callers turn it into words. */
type Refusal =
  | "logInAgain"
  | "notAllowed"
  | "self"
  | "ownKennitala"
  | "minor"
  | "gone"
  | "ownProperty"
  | "kennitalaRequired"
  | "mismatch"
  | "nameRequired"
  | "personName"
  | "confirmRequired";

type CoreResult =
  | { ok: true; subjectId: string; created: boolean; profileCreated: boolean }
  | { ok: false; refusal: Refusal }
  /** A limit that wasn't counted before the transaction turned out to apply: count it and run again. */
  | { ok: false; needs: LimitName };

type CoreInput = {
  authorId: string;
  kind: ReviewKind;
  rating: number;
  title: string;
  body: string;
  target:
    | { by: "id"; id: string; kennitala: ParsedKennitala | null }
    | { by: "kennitala"; kennitala: ParsedKennitala; name: string | null; confirmNew: boolean };
  counted: Counted;
};

const refuse = (refusal: Refusal): CoreResult => ({ ok: false, refusal });

/** The author's review of this subject in this kind, if any (rows are locked by the update that follows). */
function mine(authorId: string, kind: ReviewKind, subjectId: string) {
  return and(
    eq(reviews.authorId, authorId),
    kind === "property"
      ? eq(reviews.propertyId, subjectId)
      : and(eq(reviews.subjectUserId, subjectId), eq(reviews.kind, kind)),
  );
}

/** Update the author's existing review of the subject. True if there was one. */
async function updateExisting(tx: Transaction, input: CoreInput, subjectId: string): Promise<boolean> {
  const updated = await tx
    .update(reviews)
    .set({ rating: input.rating, title: input.title, body: input.body, updatedAt: new Date() })
    .where(mine(input.authorId, input.kind, subjectId))
    .returning({ id: reviews.id });
  return updated.length > 0;
}

/** Insert the review; if a double-submit got there first, update that one instead. True if inserted. */
async function insertReview(tx: Transaction, input: CoreInput, subjectId: string): Promise<boolean> {
  try {
    // A savepoint, so a duplicate-key error doesn't abort the whole transaction.
    await tx.transaction(async (savepoint) => {
      await savepoint.insert(reviews).values({
        kind: input.kind,
        authorId: input.authorId,
        subjectUserId: input.kind === "property" ? null : subjectId,
        propertyId: input.kind === "property" ? subjectId : null,
        rating: input.rating,
        title: input.title,
        body: input.body,
      });
    });
    return true;
  } catch (error) {
    if (pgErrorCode(error) !== "23505") throw error;
    // Keep the text just submitted.
    await updateExisting(tx, input, subjectId);
    return false;
  }
}

/**
 * Write the review, in the order of spec §5: lock the author, pure checks,
 * edit an existing review, otherwise check the kennitala (profile page) or
 * find or create the person (wizard), then insert. Any refusal rolls the
 * transaction back (see inTransaction), including role grants already made.
 */
async function saveReviewCore(tx: Transaction, input: CoreInput): Promise<CoreResult> {
  const { authorId, kind, target, counted } = input;

  // 1. The author, still an account. A key-share lock waits for an account being
  // closed and doesn't conflict with the subject lock (NO KEY UPDATE) another
  // review may hold on this row, so two people reviewing each other can't deadlock.
  const [author] = await tx
    .select({ id: users.id, kennitala: users.kennitala, isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(users)
    .where(and(eq(users.id, authorId), isNotNull(users.passwordHash)))
    .for("key share");
  if (!author) return refuse("logInAgain");
  // Renters review landlords and properties; landlords review renters.
  if (!hasRole(author, reviewerRole(kind))) return refuse("notAllowed");

  if (kind === "property") {
    if (target.by !== "id") return refuse("gone");
    const [property] = await tx
      .select({ id: properties.id, landlordId: properties.landlordId })
      .from(properties)
      .where(eq(properties.id, target.id))
      .for("share");
    if (!property) return refuse("gone");
    if (property.landlordId === author.id) return refuse("ownProperty");
    if (await updateExisting(tx, input, property.id)) {
      return { ok: true, subjectId: property.id, created: false, profileCreated: false };
    }
    if (!counted.newReview) return { ok: false, needs: "newReview" };
    const created = await insertReview(tx, input, property.id);
    return { ok: true, subjectId: property.id, created, profileCreated: false };
  }

  // 2. Pure checks.
  if (target.by === "id" && target.id === author.id) return refuse("self");
  const kennitala = target.kennitala;
  if (kennitala) {
    if (kennitala.value === author.kennitala) return refuse("ownKennitala");
    if (!isAdultKennitala(kennitala)) return refuse("minor");
  }

  if (target.by === "id") {
    // 3. An edit needs no kennitala: decided by the reviews table, not by the form.
    if (await updateExisting(tx, input, target.id)) {
      return { ok: true, subjectId: target.id, created: false, profileCreated: false };
    }
    // 4. A new review must name the profile's kennitala.
    if (!kennitala) return refuse("kennitalaRequired");
    if (!counted.check) return { ok: false, needs: "check" };
    if (!counted.newReview) return { ok: false, needs: "newReview" };
    if (!(await grantRoleById(tx, target.id, kennitala.value, kind))) {
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, target.id));
      return refuse(exists ? "mismatch" : "gone");
    }
    // 5.
    const created = await insertReview(tx, input, target.id);
    return { ok: true, subjectId: target.id, created, profileCreated: false };
  }

  // 4. The wizard: whoever has this kennitala, or a new profile without an account.
  let subjectId: string;
  let profileCreated = false;
  const person = await grantRoleByKennitala(tx, target.kennitala.value, kind);
  if (person) {
    subjectId = person.id;
  } else {
    if (!target.name) return refuse("nameRequired");
    if (target.kennitala.type === "person" && !isPersonName(target.name)) return refuse("personName");
    if (!target.confirmNew) return refuse("confirmRequired");
    if (!counted.newProfile) return { ok: false, needs: "newProfile" };
    const ensured = await ensurePerson(tx, {
      kennitala: target.kennitala.value,
      name: target.name,
      isCompany: target.kennitala.type === "company",
      role: kind,
    });
    subjectId = ensured.id;
    profileCreated = ensured.created;
  }
  // 3. (now that we know who it is)
  if (await updateExisting(tx, input, subjectId)) {
    return { ok: true, subjectId, created: false, profileCreated };
  }
  if (!counted.newReview) return { ok: false, needs: "newReview" };
  // 5.
  const created = await insertReview(tx, input, subjectId);
  return { ok: true, subjectId, created, profileCreated };
}

/** Run the core in a transaction that is rolled back on any refusal. */
async function inTransaction(input: CoreInput): Promise<CoreResult> {
  const db = await getDb();
  const box: { refused?: CoreResult } = {};
  try {
    return await db.transaction(async (tx) => {
      const result = await saveReviewCore(tx, input);
      if (!result.ok) {
        box.refused = result;
        tx.rollback();
      }
      return result;
    });
  } catch (error) {
    if (box.refused && error instanceof TransactionRollbackError) return box.refused;
    throw error;
  }
}

/**
 * Run the core, counting any limit it turns out to need and trying again.
 * Null when a limit is exceeded.
 */
async function runCore(input: Omit<CoreInput, "counted">, limits: HeldLimits): Promise<CoreResult | null> {
  for (let round = 0; round < 4; round++) {
    const result = await inTransaction({ ...input, counted: limits.counted() });
    if (result.ok || !("needs" in result)) return result;
    if (!(await limits.consume(result.needs))) return null;
  }
  throw new Error("saveReview: rate limits kept changing");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether the author already reviewed this subject in this kind (outside any transaction). */
async function hasReviewed(authorId: string, kind: ReviewKind, subjectId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select({ id: reviews.id }).from(reviews).where(mine(authorId, kind, subjectId)).limit(1);
  return Boolean(row);
}

function revalidateReviewPages(kind: ReviewKind, subjectId: string) {
  if (kind === "property") {
    revalidatePath(subjectPath("property", subjectId));
    revalidatePath("/properties");
  } else {
    // Both pages: someone with both roles has a tab per role showing each rating.
    for (const role of ["landlord", "renter"] as const) {
      revalidatePath(subjectPath(role, subjectId));
      revalidatePath(`/${role}s`);
    }
  }
  revalidatePath("/");
  revalidatePath("/dashboard");
}

/** Refusals about the details of a new profile (the wizard's review step shows them). */
const NEW_PROFILE_REFUSALS: ReadonlySet<Refusal> = new Set(["nameRequired", "personName", "confirmRequired"]);

/** A refusal in the visitor's language: a field error, or a banner. */
function refusalState(t: T, refusal: Refusal, kind: ReviewKind, formData: FormData): FormState {
  const values = formValues(formData);
  const personKind: PersonKind = kind === "property" ? "landlord" : kind;
  const fieldError = (field: string, message: string): FormState => ({
    status: "error",
    message: t("validation.fixHighlighted"),
    fieldErrors: { [field]: [message] },
    values,
  });
  switch (refusal) {
    case "logInAgain":
      return { status: "error", message: t("errors.logInAgain") };
    case "notAllowed":
      return { status: "error", message: t(`reviews.messages.notAllowed.${kind}`), values };
    case "self":
      return { status: "error", message: t("reviews.messages.self"), values };
    case "gone":
      return { status: "error", message: t(`reviews.messages.gone.${kind}`), values };
    case "ownProperty":
      return { status: "error", message: t("reviews.messages.ownProperty"), values };
    case "ownKennitala":
      return fieldError("subjectKennitala", t("reviews.messages.ownKennitala"));
    case "minor":
      return fieldError("subjectKennitala", t("reviews.messages.minor"));
    case "mismatch":
      return fieldError("subjectKennitala", t("reviews.messages.mismatch"));
    case "kennitalaRequired":
      return fieldError("subjectKennitala", t(`reviews.messages.kennitalaRequired.${personKind}`));
    case "nameRequired":
      return fieldError("subjectName", t("validation.name.tooShort", { count: LIMITS.name.min }));
    case "personName":
      return fieldError("subjectName", t("validation.name.personChars"));
    case "confirmRequired":
      return fieldError("confirmNew", t("reviews.messages.confirmRequired"));
  }
}

function tooManyAttempts(t: T, formData: FormData): FormState {
  return { status: "error", message: t("errors.tryLater"), values: formValues(formData) };
}

// ---------------------------------------------------------------------------
// The review form on profile and property pages
// ---------------------------------------------------------------------------

/**
 * Create the signed-in user's review of a landlord, renter or property, or
 * update it if they already wrote one. A new review of a person needs that
 * person's kennitala (`subjectKennitala`); an edit doesn't.
 */
export async function saveReview(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("reviews.messages.logIn") };

  const parsed = parseForm(reviewSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const { kind, subjectId, rating, title, body } = parsed.data;
  // Property reviews never take a kennitala; the schema already checked the format.
  const kennitala =
    kind !== "property" && parsed.data.subjectKennitala ? parseKennitalaInput(parsed.data.subjectKennitala) : null;

  const limits = new HeldLimits(limitsForUser(user.id, kind === "property" ? null : subjectId));
  // Count what a new review needs up front (the core asks for anything missed).
  if (!(await hasReviewed(user.id, kind, subjectId))) {
    if (!(await limits.consume("newReview"))) return tooManyAttempts(t, formData);
    if (kennitala && !(await limits.consume("check"))) {
      await limits.release("newReview");
      return tooManyAttempts(t, formData);
    }
  }

  const result = await runCore(
    { authorId: user.id, kind, rating, title, body, target: { by: "id", id: subjectId, kennitala } },
    limits,
  );
  if (!result) {
    await limits.release("newReview", "check");
    return tooManyAttempts(t, formData);
  }
  if (!result.ok) {
    // Only a kennitala that didn't match counts against the limits.
    const refusal = "refusal" in result ? result.refusal : "logInAgain";
    await limits.release(...(refusal === "mismatch" ? (["newReview"] as const) : (["newReview", "check"] as const)));
    return refusalState(t, refusal, kind, formData);
  }
  // A match (or an edit) un-counts the kennitala check.
  await limits.release(...(result.created ? (["check"] as const) : (["newReview", "check"] as const)));

  revalidateReviewPages(kind, result.subjectId);
  return {
    status: "success",
    message: result.created ? t("reviews.messages.live") : t("reviews.messages.updated"),
  };
}

// ---------------------------------------------------------------------------
// /reviews/new
// ---------------------------------------------------------------------------

function describeSubject(kennitala: ParsedKennitala, person: Person | null, formatDate: (d: Date) => string): WizardSubject {
  const isCompany = person ? person.isCompany : kennitala.type === "company";
  return {
    id: person?.id ?? null,
    name: person?.name ?? null,
    hasAccount: person?.hasAccount ?? false,
    isCompany,
    formattedKennitala: formatKennitala(kennitala.value),
    birthDate: kennitala.type === "person" && kennitala.birthDate ? formatDate(kennitala.birthDate) : null,
  };
}

/**
 * /reviews/new. intent "check" looks the kennitala up and moves to the review
 * step (or, if the author already reviewed that person in this role, to their
 * review on the profile). intent "save" writes the review, creating a profile
 * without an account for a kennitala nobody has yet, and goes to the profile.
 */
export async function reviewWizard(_prev: WizardState, formData: FormData): Promise<WizardState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("reviews.messages.logIn"), step: "kennitala" };

  const intent = formData.get("intent") === "check" ? "check" : "save";
  const parsed = parseForm(reviewWizardSchema, formData, t);
  const values = formValues(formData);
  const backToStart = (state: FormState): WizardState => ({ ...state, step: "kennitala" });

  // Who it's about. These two always come first, whatever else is wrong.
  const rawKind = formData.get("kind");
  const rawKennitala = formData.get("subjectKennitala");
  const kennitala = typeof rawKennitala === "string" ? parseKennitalaInput(rawKennitala.trim()) : null;
  if (!parsed.success) {
    const fields = parsed.state.fieldErrors ?? {};
    if (intent === "check" || fields.kind || fields.subjectKennitala || fields.intent || !kennitala) {
      // `kind` is a hidden field (chosen in the step before): say what's wrong in the banner.
      return backToStart(fields.kind ? { ...parsed.state, message: fields.kind[0] } : parsed.state);
    }
  }
  if ((rawKind !== "landlord" && rawKind !== "renter") || !kennitala) {
    return backToStart({ status: "error", message: t("validation.fixHighlighted"), values });
  }
  const kind: PersonKind = rawKind;

  // Checks that need no lookup: the author's role, their own number, a minor.
  const db = await getDb();
  const [author] = await db
    .select({ kennitala: users.kennitala, isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(users)
    .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)));
  if (!author) return backToStart({ status: "error", message: t("errors.logInAgain") });
  if (!hasRole(author, reviewerRole(kind))) {
    return backToStart(refusalState(t, "notAllowed", kind, formData));
  }
  if (kennitala.value === author.kennitala) return backToStart(refusalState(t, "ownKennitala", kind, formData));
  if (!isAdultKennitala(kennitala)) return backToStart(refusalState(t, "minor", kind, formData));

  // Every lookup counts, found or not.
  const limits = new HeldLimits(limitsForUser(user.id, null));
  if (!(await limits.consume("check"))) return backToStart(tooManyAttempts(t, formData));
  const person = await findPersonByKennitala(kennitala.value);
  const format = await getFormat();
  const subject = describeSubject(kennitala, person, format.date);
  const reviewStep = (state: FormState, shown = subject): WizardState => ({ ...state, step: "review", subject: shown });

  if (intent === "check") {
    if (person && (await hasReviewed(user.id, kind, person.id))) {
      redirect(`${subjectPath(kind, person.id)}#your-review`);
    }
    return reviewStep({ status: "idle", values: { kind, subjectKennitala: subject.formattedKennitala } });
  }
  if (!parsed.success) return reviewStep(parsed.state);
  const data = parsed.data;
  if (data.intent !== "save") return reviewStep({ status: "idle", values });

  // A new profile: its name and the confirmation, before counting anything else.
  if (!person) {
    const refusal: Refusal | null = !data.subjectName
      ? "nameRequired"
      : kennitala.type === "person" && !isPersonName(data.subjectName)
        ? "personName"
        : !data.confirmNew
          ? "confirmRequired"
          : null;
    if (refusal) return reviewStep(refusalState(t, refusal, kind, formData));
    if (!(await limits.consume("newProfile"))) return reviewStep(tooManyAttempts(t, formData));
  }
  if (!person || !(await hasReviewed(user.id, kind, person.id))) {
    if (!(await limits.consume("newReview"))) {
      await limits.release("newProfile");
      return reviewStep(tooManyAttempts(t, formData));
    }
  }

  const result = await runCore(
    {
      authorId: user.id,
      kind,
      rating: data.rating,
      title: data.title,
      body: data.body,
      target: { by: "kennitala", kennitala, name: data.subjectName, confirmNew: data.confirmNew },
    },
    limits,
  );
  if (!result) {
    await limits.release("newReview", "newProfile");
    return reviewStep(tooManyAttempts(t, formData));
  }
  if (!result.ok) {
    await limits.release("newReview", "newProfile");
    const refusal = "refusal" in result ? result.refusal : "logInAgain";
    const state = refusalState(t, refusal, kind, formData);
    if (!NEW_PROFILE_REFUSALS.has(refusal)) return backToStart(state);
    // Nobody has the number (any more, if the profile was deleted since the lookup): ask for a name.
    return reviewStep(state, describeSubject(kennitala, null, format.date));
  }
  await limits.release(...(result.created ? [] : (["newReview"] as const)), ...(result.profileCreated ? [] : (["newProfile"] as const)));

  revalidateReviewPages(kind, result.subjectId);
  redirect(`${subjectPath(kind, result.subjectId)}?saved=1#your-review`);
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Delete one of the signed-in user's own reviews. A profile without an
 * account that nothing refers to any more is deleted with it (then the
 * author goes to their dashboard, since the page they were on is gone).
 */
export async function deleteReview(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const reviewId = formData.get("reviewId");
  if (!user || typeof reviewId !== "string" || !isUuid(reviewId)) return;

  const db = await getDb();
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(reviews)
      .where(and(eq(reviews.id, reviewId), eq(reviews.authorId, user.id)))
      .returning({ kind: reviews.kind, subjectUserId: reviews.subjectUserId, propertyId: reviews.propertyId });
    if (!row) return null;
    if (!row.subjectUserId) return { ...row, profileGone: false };
    await reconcileProfiles(tx, [row.subjectUserId]);
    const [still] = await tx.select({ id: users.id }).from(users).where(eq(users.id, row.subjectUserId));
    return { ...row, profileGone: !still };
  });
  if (!deleted) return;

  revalidateReviewPages(deleted.kind, (deleted.propertyId ?? deleted.subjectUserId)!);
  if (deleted.profileGone) redirect("/dashboard");
}
