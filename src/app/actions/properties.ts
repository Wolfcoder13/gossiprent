"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode } from "@/db";
import { properties, reviews, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findPropertyByAddress, getProperty, isUuid } from "@/lib/data";
import { formValues, parseForm, propertySchema, type FormState } from "@/lib/validation";

/**
 * Add a property. A landlord can list it as their own ("me"); a renter can
 * link their landlord if they're on GossipRent. Someone who is only a
 * landlord always lists it as their own.
 */
export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in to add a property." };

  const parsed = parseForm(propertySchema, formData);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;

  const db = await getDb();
  const fieldError = (message: string): FormState => ({
    status: "error",
    message: "Please fix the highlighted fields.",
    fieldErrors: { landlordId: [message] },
    values: formValues(formData),
  });
  // Someone with both roles must say whether they own or rent the place. A
  // landlord of "me" (or their own id) means own, and picking another
  // landlord means rent; an empty landlord field on its own decides nothing
  // (the picker is always in their form, just hidden until they pick "Rent").
  const relation =
    data.relation ??
    (data.landlordId === "me" || data.landlordId === user.id
      ? "own"
      : data.landlordId
        ? "rent"
        : undefined);
  if (user.isLandlord && user.isRenter && !relation) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { relation: ["Choose whether you own or rent this place."] },
      values: formValues(formData),
    };
  }
  let landlordId: string | null = null;
  if (relation === "own" || data.landlordId === "me" || data.landlordId === user.id || !user.isRenter) {
    if (!user.isLandlord) {
      return fieldError("Only landlords can list themselves as the landlord.");
    }
    landlordId = user.id;
  } else if (data.landlordId) {
    const [landlord] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, data.landlordId), eq(users.isLandlord, true), isNull(users.deletedAt)),
      )
      .limit(1);
    if (!landlord) return fieldError("That landlord isn't on GossipRent anymore.");
    landlordId = landlord.id;
  }

  const duplicate = async (existingId: string): Promise<FormState> => {
    const existing = await getProperty(existingId);
    const claimable = user.isLandlord && existing && !existing.landlord;
    return {
      status: "error",
      message: claimable
        ? "This property is already listed, without a landlord. If you manage it, you can claim it."
        : "This property is already listed on GossipRent.",
      link: {
        href: `/properties/${existingId}`,
        label: claimable ? "Go to the listing to claim it" : "Go to the existing listing",
      },
      values: formValues(formData),
    };
  };

  const existing = await findPropertyByAddress(data);
  if (existing) return duplicate(existing.id);

  let propertyId: string;
  try {
    const created = await db.transaction(async (tx) => {
      if (landlordId) {
        // Re-check the landlord (you, or the one you picked) under a lock, so
        // they can't drop the landlord role or close their account meanwhile.
        const [landlord] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, landlordId), eq(users.isLandlord, true), isNull(users.deletedAt)))
          .for("share");
        if (!landlord) return null;
      }
      const [row] = await tx
        .insert(properties)
        .values({
          address: data.address,
          unit: data.unit,
          city: data.city,
          region: data.region,
          postalCode: data.postalCode,
          description: data.description,
          landlordId,
          createdById: user.id,
        })
        .returning({ id: properties.id });
      return row;
    });
    if (!created) {
      return fieldError(
        landlordId === user.id
          ? "Only landlords can list themselves as the landlord."
          : "That landlord isn't on GossipRent anymore.",
      );
    }
    propertyId = created.id;
  } catch (error) {
    if (pgErrorCode(error) !== "23505") throw error;
    const raced = await findPropertyByAddress(data);
    if (!raced) throw error;
    return duplicate(raced.id);
  }

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  if (landlordId) revalidatePath(`/landlords/${landlordId}`);
  redirect(`/properties/${propertyId}`);
}

function revalidatePropertyPages(propertyId: string, landlordIds: (string | null)[]) {
  revalidatePath(`/properties/${propertyId}`);
  revalidatePath("/properties");
  revalidatePath("/dashboard");
  for (const id of landlordIds) if (id) revalidatePath(`/landlords/${id}`);
}

const CLAIM_MESSAGES = {
  claimed: { status: "success", message: "Done. You're now listed as this property's landlord." },
  "not-landlord": { status: "error", message: "Only landlords can claim a property." },
  missing: { status: "error", message: "That property doesn't exist." },
  taken: { status: "error", message: "Another landlord already manages this property." },
  reviewed: {
    status: "error",
    message:
      "You've reviewed this property as a renter, so you can't also be its landlord. Delete your review first.",
  },
} satisfies Record<string, FormState>;

/**
 * A landlord claims a listed property that has no landlord yet. Refused if
 * they've reviewed it, since landlords can't review their own properties.
 */
export async function claimProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };
  const propertyId = formData.get("propertyId");
  if (typeof propertyId !== "string" || !isUuid(propertyId)) return CLAIM_MESSAGES.missing;

  const db = await getDb();
  // Locks: the user row (so the landlord role can't be removed mid-claim) and
  // the property row (so two claims, or a claim and a review, take turns).
  const outcome = await db.transaction(async (tx) => {
    const [me] = await tx
      .select({ isLandlord: users.isLandlord })
      .from(users)
      .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
      .for("share");
    if (!me?.isLandlord) return "not-landlord" as const;
    const [property] = await tx
      .select({ landlordId: properties.landlordId })
      .from(properties)
      .where(eq(properties.id, propertyId))
      .for("update");
    if (!property) return "missing" as const;
    if (property.landlordId) return property.landlordId === user.id ? ("claimed" as const) : ("taken" as const);
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
  if (outcome !== "missing") revalidatePropertyPages(propertyId, [user.id]);
  return CLAIM_MESSAGES[outcome];
}

/**
 * The linked landlord removes themselves from a property (e.g. a renter linked
 * the wrong landlord). The listing and its reviews stay.
 */
export async function unlinkProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };
  const propertyId = formData.get("propertyId");
  if (typeof propertyId !== "string" || !isUuid(propertyId)) {
    return { status: "error", message: "That property doesn't exist." };
  }
  const db = await getDb();
  const unlinked = await db
    .update(properties)
    .set({ landlordId: null })
    .where(and(eq(properties.id, propertyId), eq(properties.landlordId, user.id)))
    .returning({ id: properties.id });
  revalidatePropertyPages(propertyId, [user.id]);
  return unlinked.length > 0
    ? { status: "success", message: "Done. You're no longer listed as this property's landlord." }
    : { status: "error", message: "You aren't listed as this property's landlord." };
}

/**
 * "I manage this property" / "Not my property" share one form. Passing a
 * Server Action (not a client wrapper) to useActionState keeps the form
 * working before JavaScript loads.
 */
export async function updatePropertyLandlord(prev: FormState, formData: FormData): Promise<FormState> {
  return formData.get("intent") === "claim"
    ? claimProperty(prev, formData)
    : unlinkProperty(prev, formData);
}
