"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode } from "@/db";
import { properties, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findPropertyByAddress } from "@/lib/data";
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
      .where(and(eq(users.id, data.landlordId), eq(users.role, "landlord")))
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

  const duplicate = (existingId: string): FormState => ({
    status: "error",
    message: "This property is already listed on GossipRent.",
    link: { href: `/properties/${existingId}`, label: "Go to the existing listing" },
    values: formValues(formData),
  });

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
