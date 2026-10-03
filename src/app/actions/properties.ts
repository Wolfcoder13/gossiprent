"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, pgErrorCode, type Transaction } from "@/db";
import { properties, reviews, users } from "@/db/schema";
import { getFormat, getT, type T } from "@/i18n/server";
import { getCurrentUser, type SessionUser } from "@/lib/auth/current-user";
import {
  clientIp,
  consumeAttempt,
  kennitalaCheckLimits,
  newProfileLimits,
} from "@/lib/auth/rate-limit";
import { findPropertyByAddress, getProperty, isUuid } from "@/lib/data";
import {
  formatKennitala,
  isAdultKennitala,
  parseKennitalaInput,
  type ParsedKennitala,
} from "@/lib/kennitala";
import { subjectPath } from "@/lib/paths";
import {
  ensurePerson,
  findPersonByKennitala,
  grantRoleByKennitala,
  propertyAddressKeys,
  reconcileProfiles,
  type Person,
} from "@/lib/people";
import type { FormState } from "@/lib/form-state";
import {
  checkbox,
  formValues,
  isPersonName,
  optional,
  optionalKennitalaField,
  parseForm,
  personOrCompanyName,
  propertySchema,
} from "@/lib/validation";

/*
 * Properties (docs/iceland-spec.md §6): adding one, and who its landlord is.
 *
 * A renter can link the landlord by kennitala. Someone with that kennitala
 * gets the landlord role; a kennitala nobody has yet becomes a profile
 * without an account, named as the renter typed it. Looking a kennitala up
 * (the "Check" button, or saving with one) is rate limited like every other
 * kennitala check, and limits are counted before any transaction: the
 * embedded database runs one transaction at a time, so nothing else may
 * query while one is open.
 *
 * The creator of a property can change its landlord while that landlord has
 * no account; a landlord with an account can only unlink themselves.
 */

/** What a kennitala lookup found, for the author who typed it (never anyone else). */
export type LandlordLookup = {
  /** Someone on GossipRent has this kennitala. */
  found: boolean;
  /** Their name, when found. */
  name: string | null;
  isCompany: boolean;
  /** A person's birth date (formatted), when nobody has the kennitala yet: helps spot a typo. */
  birthDate: string | null;
};

/** The add-a-property and change-the-landlord forms. `landlord` answers a "Check" (or a save that needs a name). */
export type PropertyFormState = FormState & { landlord?: LandlordLookup };

const LANDLORD_FIELDS: readonly string[] = ["landlordKennitala", "landlordName", "confirmNewLandlord"];

function fieldError(
  t: T,
  formData: FormData,
  field: string,
  message: string,
  extra: Partial<PropertyFormState> = {},
): PropertyFormState {
  return {
    status: "error",
    message: t("validation.fixHighlighted"),
    fieldErrors: { [field]: [message] },
    values: formValues(formData),
    ...extra,
  };
}

function tooManyAttempts(t: T, formData: FormData, extra: Partial<PropertyFormState> = {}): PropertyFormState {
  return { status: "error", message: t("errors.tryLater"), values: formValues(formData), ...extra };
}

/** The signed-in account's own kennitala, compared here (never sent in a query); null if it's no longer an account. */
async function ownKennitala(userId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ kennitala: users.kennitala })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.passwordHash)));
  return row?.kennitala ?? null;
}

// ---------------------------------------------------------------------------
// Landlord by kennitala (shared by adding a property and changing its landlord)
// ---------------------------------------------------------------------------

/**
 * Checks that need no lookup: the author's own kennitala, and a minor's
 * (refused with a neutral message). Null if neither.
 */
async function kennitalaRefusal(
  t: T,
  userId: string,
  kennitala: ParsedKennitala,
  formData: FormData,
): Promise<PropertyFormState | null> {
  const own = await ownKennitala(userId);
  if (!own) return { status: "error", message: t("errors.logInAgain") };
  if (kennitala.value === own) {
    return fieldError(t, formData, "landlordKennitala", t("properties.messages.ownKennitala"));
  }
  if (!isAdultKennitala(kennitala)) {
    return fieldError(t, formData, "landlordKennitala", t("properties.messages.minor"));
  }
  return null;
}

/** Count one kennitala lookup. False if over a limit. */
async function consumeCheck(userId: string): Promise<boolean> {
  const attempt = await consumeAttempt(kennitalaCheckLimits(userId, await clientIp()));
  return !attempt.limited;
}

async function describeLookup(kennitala: ParsedKennitala, person: Person | null): Promise<LandlordLookup> {
  const format = await getFormat();
  return {
    found: Boolean(person),
    name: person?.name ?? null,
    isCompany: person ? person.isCompany : kennitala.type === "company",
    birthDate:
      !person && kennitala.type === "person" && kennitala.birthDate ? format.date(kennitala.birthDate) : null,
  };
}

/** "Check": who has this kennitala, without saving anything. */
async function lookUpLandlord(t: T, userId: string, value: string, formData: FormData): Promise<PropertyFormState> {
  const kennitala = parseKennitalaInput(value)!;
  const refusal = await kennitalaRefusal(t, userId, kennitala, formData);
  if (refusal) return refusal;
  if (!(await consumeCheck(userId))) return tooManyAttempts(t, formData);
  const person = await findPersonByKennitala(kennitala.value);
  return {
    status: "idle",
    // The author's own form echo, formatted.
    values: { ...formValues(formData), landlordKennitala: formatKennitala(kennitala.value) },
    landlord: await describeLookup(kennitala, person),
  };
}

/** The landlord to link, decided before the transaction (null: none). */
type LandlordPlan = {
  kennitala: ParsedKennitala;
  /** Nobody had the kennitala at lookup: create a profile with this name. */
  newProfile: { name: string; release: () => Promise<void> } | null;
};

type Prepared = { ok: true; plan: LandlordPlan | null } | { ok: false; state: PropertyFormState };

/**
 * Look up the landlord's kennitala (counted as a kennitala check). A
 * kennitala nobody has yet needs a name and the confirmation, and counts
 * against the new-profile limit.
 */
async function prepareLandlord(
  t: T,
  userId: string,
  data: { landlordKennitala: string | null; landlordName: string | null; confirmNewLandlord: boolean },
  formData: FormData,
): Promise<Prepared> {
  if (!data.landlordKennitala) return { ok: true, plan: null };
  const kennitala = parseKennitalaInput(data.landlordKennitala)!;
  const refusal = await kennitalaRefusal(t, userId, kennitala, formData);
  if (refusal) return { ok: false, state: refusal };
  if (!(await consumeCheck(userId))) return { ok: false, state: tooManyAttempts(t, formData) };

  const person = await findPersonByKennitala(kennitala.value);
  if (person) return { ok: true, plan: { kennitala, newProfile: null } };

  const landlord = await describeLookup(kennitala, null);
  const name = data.landlordName;
  const fail = (field: string, message: string): Prepared => ({
    ok: false,
    state: fieldError(t, formData, field, message, { landlord }),
  });
  if (!name) return fail("landlordName", t("properties.messages.nameRequired"));
  if (kennitala.type === "person" && !isPersonName(name)) {
    return fail("landlordName", t("validation.name.personChars"));
  }
  if (!data.confirmNewLandlord) return fail("confirmNewLandlord", t("properties.messages.confirmRequired"));
  const attempt = await consumeAttempt(newProfileLimits(userId));
  if (attempt.limited) return { ok: false, state: tooManyAttempts(t, formData, { landlord }) };
  return { ok: true, plan: { kennitala, newProfile: { name, release: attempt.release } } };
}

/**
 * Inside the transaction: give the person with the kennitala the landlord
 * role (locking their row), or create their profile. Null if the person found
 * at lookup is gone and there's no name to create them with.
 */
async function linkLandlord(tx: Transaction, plan: LandlordPlan): Promise<{ id: string; created: boolean } | null> {
  const person = await grantRoleByKennitala(tx, plan.kennitala.value, "landlord");
  if (person) return { id: person.id, created: false };
  if (!plan.newProfile) return null;
  return ensurePerson(tx, {
    kennitala: plan.kennitala.value,
    name: plan.newProfile.name,
    isCompany: plan.kennitala.type === "company",
    role: "landlord",
  });
}

/** The person found at lookup was deleted before the link: ask for a name, as for a new kennitala. */
async function vanishedState(t: T, plan: LandlordPlan, formData: FormData): Promise<PropertyFormState> {
  return fieldError(t, formData, "landlordName", t("properties.messages.nameRequired"), {
    landlord: await describeLookup(plan.kennitala, null),
  });
}

function revalidateLandlordPages(...landlordIds: (string | null)[]) {
  revalidatePath("/landlords");
  for (const id of new Set(landlordIds)) {
    if (!id) continue;
    // Their renter page too: it shows the roles they have.
    revalidatePath(subjectPath("landlord", id));
    revalidatePath(subjectPath("renter", id));
  }
}

// ---------------------------------------------------------------------------
// Adding a property
// ---------------------------------------------------------------------------

/** The form without its landlord fields (ignored when you list a property as your own). */
function withoutLandlordFields(formData: FormData): FormData {
  const copy = new FormData();
  for (const [key, value] of formData.entries()) {
    if (!LANDLORD_FIELDS.includes(key)) copy.append(key, value);
  }
  return copy;
}

async function duplicateState(
  t: T,
  user: SessionUser,
  existingId: string,
  formData: FormData,
): Promise<PropertyFormState> {
  const existing = await getProperty(existingId);
  const claimable = user.isLandlord && existing && !existing.landlord;
  return {
    status: "error",
    message: t(claimable ? "properties.messages.alreadyListedClaimable" : "properties.messages.alreadyListed"),
    link: {
      href: `/properties/${existingId}`,
      label: t(claimable ? "properties.messages.goToClaim" : "properties.messages.goToListing"),
    },
    values: formValues(formData),
  };
}

type CreateResult =
  | { ok: true; propertyId: string; landlordId: string | null; profileCreated: boolean }
  | { ok: false; refusal: "logInAgain" | "onlyLandlordsOwn" | "vanished" };

/**
 * Add a property. Someone who is only a landlord lists it as their own, and
 * someone who is only a renter adds a place they rent (optionally naming its
 * landlord by kennitala). Someone with both roles says which ("own" or
 * "rent"). intent "check" only reports who the landlord's kennitala belongs to.
 */
export async function createProperty(_prev: PropertyFormState, formData: FormData): Promise<PropertyFormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("properties.messages.logIn") };

  const checking = formData.get("intent") === "check";
  const relationField = formData.get("relation");
  const ownsIt = !user.isRenter || (user.isLandlord && relationField === "own");
  // Listing it as your own ignores the (hidden) landlord fields, whatever they hold.
  const parsed = parseForm(propertySchema, !checking && ownsIt ? withoutLandlordFields(formData) : formData, t);
  if (!parsed.success) return { ...parsed.state, values: formValues(formData) };
  const data = parsed.data;
  if (data.intent === "check") return lookUpLandlord(t, user.id, data.landlordKennitala, formData);

  const relation = !user.isRenter ? "own" : !user.isLandlord ? "rent" : data.relation;
  if (!relation) return fieldError(t, formData, "relation", t("validation.relation.required"));

  // A duplicate is reported before anything is looked up or written.
  const existing = await findPropertyByAddress(data);
  if (existing) return duplicateState(t, user, existing.id, formData);

  let plan: LandlordPlan | null = null;
  if (relation === "rent") {
    const prepared = await prepareLandlord(t, user.id, data, formData);
    if (!prepared.ok) return prepared.state;
    plan = prepared.plan;
  }

  const db = await getDb();
  let result: CreateResult;
  try {
    result = await db.transaction(async (tx): Promise<CreateResult> => {
      // The author, still an account. Listing it as your own takes a share lock,
      // so the landlord role can't be removed (or the account closed) meanwhile;
      // otherwise a key-share lock, which doesn't conflict with a review's lock.
      const [author] = await tx
        .select({ isLandlord: users.isLandlord })
        .from(users)
        .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)))
        .for(relation === "own" ? "share" : "key share");
      if (!author) return { ok: false, refusal: "logInAgain" };

      let landlordId: string | null = null;
      let profileCreated = false;
      if (relation === "own") {
        if (!author.isLandlord) return { ok: false, refusal: "onlyLandlordsOwn" };
        landlordId = user.id;
      } else if (plan) {
        // Locks the landlord's row (the role grant), so it can't be deleted or lose the role meanwhile.
        const linked = await linkLandlord(tx, plan);
        if (!linked) return { ok: false, refusal: "vanished" };
        landlordId = linked.id;
        profileCreated = linked.created;
      }
      const [row] = await tx
        .insert(properties)
        .values({
          ...propertyAddressKeys(data.address, data.unit),
          postalCode: data.postalCode,
          description: data.description,
          landlordId,
          createdById: user.id,
        })
        .returning({ id: properties.id });
      return { ok: true, propertyId: row.id, landlordId, profileCreated };
    });
  } catch (error) {
    await plan?.newProfile?.release();
    // Someone added the same address at the same moment.
    if (pgErrorCode(error) !== "23505") throw error;
    const raced = await findPropertyByAddress(data);
    if (!raced) throw error;
    return duplicateState(t, user, raced.id, formData);
  }

  if (!result.ok) {
    await plan?.newProfile?.release();
    switch (result.refusal) {
      case "logInAgain":
        return { status: "error", message: t("errors.logInAgain") };
      case "onlyLandlordsOwn":
        return { status: "error", message: t("properties.messages.onlyLandlordsOwn"), values: formValues(formData) };
      case "vanished":
        return vanishedState(t, plan!, formData);
    }
  }
  // Someone else created the profile first: this one didn't count as a new profile.
  if (!result.profileCreated) await plan?.newProfile?.release();

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  revalidateLandlordPages(result.landlordId);
  redirect(`/properties/${result.propertyId}`);
}

// ---------------------------------------------------------------------------
// Claim, unlink, change the landlord
// ---------------------------------------------------------------------------

function revalidatePropertyPages(propertyId: string, ...landlordIds: (string | null)[]) {
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  revalidateLandlordPages(...landlordIds);
}

/**
 * A landlord claims a listed property that has no landlord yet. Refused if
 * they've reviewed it, since landlords can't review their own properties.
 */
async function claimProperty(t: T, user: SessionUser, propertyId: string): Promise<PropertyFormState> {
  const db = await getDb();
  // Locks: the user row (so the landlord role can't be removed mid-claim) and
  // the property row (so two claims, or a claim and a review, take turns).
  const outcome = await db.transaction(async (tx) => {
    const [me] = await tx
      .select({ isLandlord: users.isLandlord })
      .from(users)
      .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)))
      .for("share");
    if (!me?.isLandlord) return "notLandlord" as const;
    const [property] = await tx
      .select({ landlordId: properties.landlordId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for("update");
    if (!property) return "missing" as const;
    if (property.landlordId) {
      return property.landlordId === user.id ? ("claimed" as const) : ("taken" as const);
    }
    const [reviewed] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.propertyId, propertyId), eq(reviews.authorId, user.id)))
      .limit(1);
    if (reviewed) return "reviewed" as const;
    await tx.update(properties).set({ landlordId: user.id }).where(eq(properties.id, propertyId));
    return "claimed" as const;
  });
  // Refresh even when refused, so the page shows who manages it now.
  if (outcome !== "missing") revalidatePropertyPages(propertyId, user.id);
  switch (outcome) {
    case "claimed":
      return { status: "success", message: t("properties.messages.claimed") };
    case "notLandlord":
      return { status: "error", message: t("properties.messages.claimNotLandlord") };
    case "missing":
      return { status: "error", message: t("properties.messages.missing") };
    case "taken":
      return { status: "error", message: t("properties.messages.claimTaken") };
    case "reviewed":
      return { status: "error", message: t("properties.messages.claimReviewed") };
  }
}

/**
 * The linked landlord removes themselves from a property ("Not my property",
 * e.g. a renter linked the wrong person). The listing and its reviews stay.
 */
async function unlinkProperty(t: T, user: SessionUser, propertyId: string): Promise<PropertyFormState> {
  const db = await getDb();
  const unlinked = await db
    .update(properties)
    .set({ landlordId: null })
    .where(and(eq(properties.id, propertyId), eq(properties.landlordId, user.id)))
    .returning({ id: properties.id });
  revalidatePropertyPages(propertyId, user.id);
  return unlinked.length > 0
    ? { status: "success", message: t("properties.messages.unlinked") }
    : { status: "error", message: t("properties.messages.unlinkNotListed") };
}

/**
 * Who may change a property's landlord: its creator, while the landlord has no
 * account. (Not getProperty: it's memoized per request, and this request goes
 * on to change the row and re-render the page.)
 */
async function relinkRefusal(t: T, propertyId: string, userId: string): Promise<PropertyFormState | null> {
  const db = await getDb();
  const [property] = await db
    .select({
      createdById: properties.createdById,
      landlordHasAccount: sql<boolean>`${users.passwordHash} is not null`,
    })
    .from(properties)
    .leftJoin(users, eq(users.id, properties.landlordId))
    .where(eq(properties.id, propertyId));
  if (!property) return { status: "error", message: t("properties.messages.missing") };
  if (property.createdById !== userId) return { status: "error", message: t("properties.messages.relinkNotCreator") };
  if (property.landlordHasAccount) return { status: "error", message: t("properties.messages.relinkHasAccount") };
  return null;
}

const relinkSchema = z.object({
  landlordKennitala: optionalKennitalaField,
  landlordName: optional(personOrCompanyName),
  confirmNewLandlord: checkbox,
});

type RelinkResult =
  | { ok: true; oldLandlordId: string | null; landlordId: string | null; profileCreated: boolean }
  | { ok: false; refusal: "logInAgain" | "missing" | "notCreator" | "hasAccount" | "vanished" };

/**
 * The property's creator links another landlord by kennitala, or (with the
 * field empty) removes the link, while the linked landlord has no account.
 * A profile without an account that nothing refers to any more is deleted.
 */
async function relinkLandlord(
  t: T,
  user: SessionUser,
  propertyId: string,
  formData: FormData,
): Promise<PropertyFormState> {
  // Checked before any lookup, so only the creator can get this far.
  const refusal = await relinkRefusal(t, propertyId, user.id);
  if (refusal) return refusal;
  if (formData.get("intent") === "check") {
    const parsed = parseForm(propertySchema, formData, t);
    if (!parsed.success) return parsed.state;
    if (parsed.data.intent !== "check") return { status: "error", message: t("properties.messages.unknownAction") };
    return lookUpLandlord(t, user.id, parsed.data.landlordKennitala, formData);
  }

  const parsed = parseForm(relinkSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const prepared = await prepareLandlord(t, user.id, parsed.data, formData);
  if (!prepared.ok) return prepared.state;
  const plan = prepared.plan;

  const db = await getDb();
  let result: RelinkResult;
  try {
    result = await db.transaction(async (tx): Promise<RelinkResult> => {
      const [author] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)))
        .for("key share");
      if (!author) return { ok: false, refusal: "logInAgain" };
      const [property] = await tx
        .select({ createdById: properties.createdById, landlordId: properties.landlordId })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .for("update");
      if (!property) return { ok: false, refusal: "missing" };
      if (property.createdById !== user.id) return { ok: false, refusal: "notCreator" };
      const oldLandlordId = property.landlordId;
      if (oldLandlordId) {
        // A key-share lock: signing up with that kennitala (which sets the
        // email) waits until this is done, and then finds the new link.
        const [old] = await tx
          .select({ hasAccount: sql<boolean>`${users.passwordHash} is not null` })
          .from(users)
          .where(eq(users.id, oldLandlordId))
          .for("key share");
        if (old?.hasAccount) return { ok: false, refusal: "hasAccount" };
      }

      let landlordId: string | null = null;
      let profileCreated = false;
      if (plan) {
        const linked = await linkLandlord(tx, plan);
        if (!linked) return { ok: false, refusal: "vanished" };
        landlordId = linked.id;
        profileCreated = linked.created;
      }
      if (landlordId !== oldLandlordId) {
        await tx.update(properties).set({ landlordId }).where(eq(properties.id, propertyId));
        // The old landlord may no longer be a landlord, or referred to at all.
        if (oldLandlordId) await reconcileProfiles(tx, [oldLandlordId]);
      }
      return { ok: true, oldLandlordId, landlordId, profileCreated };
    });
  } catch (error) {
    await plan?.newProfile?.release();
    throw error;
  }

  if (!result.ok) {
    await plan?.newProfile?.release();
    switch (result.refusal) {
      case "logInAgain":
        return { status: "error", message: t("errors.logInAgain") };
      case "missing":
        return { status: "error", message: t("properties.messages.missing") };
      case "notCreator":
        return { status: "error", message: t("properties.messages.relinkNotCreator") };
      case "hasAccount":
        return { status: "error", message: t("properties.messages.relinkHasAccount") };
      case "vanished":
        return vanishedState(t, plan!, formData);
    }
  }
  if (!result.profileCreated) await plan?.newProfile?.release();

  revalidatePropertyPages(propertyId, result.oldLandlordId, result.landlordId);
  return {
    status: "success",
    message: t(result.landlordId ? "properties.messages.relinked" : "properties.messages.relinkCleared"),
  };
}

/**
 * The landlord controls on a property page, one Server Action for all of
 * them (passing a Server Action, not a client wrapper, to useActionState keeps
 * the forms working before JavaScript loads). `intent`:
 * - "claim": "I manage this property" (a landlord, for a property without one);
 * - "unlink": "Not my property" (the linked landlord);
 * - "relink": the creator links another landlord, or none ("check" looks the kennitala up first).
 */
export async function updatePropertyLandlord(
  _prev: PropertyFormState,
  formData: FormData,
): Promise<PropertyFormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("errors.logInAgain") };
  const propertyId = formData.get("propertyId");
  if (typeof propertyId !== "string" || !isUuid(propertyId)) {
    return { status: "error", message: t("properties.messages.missing") };
  }
  switch (formData.get("intent")) {
    case "claim":
      return claimProperty(t, user, propertyId);
    case "unlink":
      return unlinkProperty(t, user, propertyId);
    case "relink":
    case "check":
      return relinkLandlord(t, user, propertyId, formData);
    default:
      return { status: "error", message: t("properties.messages.unknownAction") };
  }
}
