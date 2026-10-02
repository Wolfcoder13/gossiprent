"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode } from "@/db";
import { properties, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findPropertyByAddress, getProperty, isUuid } from "@/lib/data";
import { formValues, parseForm, propertySchema, type FormState } from "@/lib/validation";

/** Add a property. Landlords always add it as their own; renters may link a landlord. */
export async function createProperty(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in to add a property." };

  const parsed = parseForm(propertySchema, formData);
  if (!parsed.success) return parsed.state;
  const data = parsed.data;

  const db = await getDb();
  let landlordId: string | null = null;
  if (user.role === "landlord") {
    landlordId = user.id;
  } else if (data.landlordId) {
    const [landlord] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(eq(users.id, data.landlordId), eq(users.role, "landlord"), isNull(users.deletedAt)),
      )
      .limit(1);
    if (!landlord) {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: { landlordId: ["That landlord isn't on GossipRent anymore."] },
        values: formValues(formData),
      };
    }
    landlordId = landlord.id;
  }

  const duplicate = async (existingId: string): Promise<FormState> => {
    const existing = await getProperty(existingId);
    const claimable = user.role === "landlord" && existing && !existing.landlord;
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
    const [created] = await db
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

/** A landlord claims a listed property that has no landlord yet. */
export async function claimProperty(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const propertyId = formData.get("propertyId");
  if (!user || user.role !== "landlord" || typeof propertyId !== "string" || !isUuid(propertyId)) {
    return;
  }
  const db = await getDb();
  await db
    .update(properties)
    .set({ landlordId: user.id })
    .where(and(eq(properties.id, propertyId), isNull(properties.landlordId)));
  revalidatePropertyPages(propertyId, [user.id]);
}

/**
 * The linked landlord removes themselves from a property (e.g. a renter linked
 * the wrong landlord). The listing and its reviews stay.
 */
export async function unlinkProperty(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const propertyId = formData.get("propertyId");
  if (!user || typeof propertyId !== "string" || !isUuid(propertyId)) return;
  const db = await getDb();
  await db
    .update(properties)
    .set({ landlordId: null })
    .where(and(eq(properties.id, propertyId), eq(properties.landlordId, user.id)));
  revalidatePropertyPages(propertyId, [user.id]);
}
