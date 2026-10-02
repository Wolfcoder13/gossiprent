"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteSession } from "@/lib/auth/session";
import { profilePath } from "@/lib/paths";
import { parseForm, profileSchema, type FormState } from "@/lib/validation";

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };

  const parsed = parseForm(profileSchema, formData);
  if (!parsed.success) return parsed.state;
  const { name, city, bio } = parsed.data;

  const db = await getDb();
  await db.update(users).set({ name, city, bio }).where(eq(users.id, user.id));

  revalidatePath("/", "layout");
  revalidatePath(profilePath(user));
  return {
    status: "success",
    message: "Profile saved.",
    values: { name, city: city ?? "", bio: bio ?? "" },
  };
}

/**
 * Permanently delete the signed-in user's account, every review they wrote,
 * and every review written about them. Properties they added stay listed.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (formData.get("confirm") !== "delete") return;

  const db = await getDb();
  await deleteSession();
  await db.delete(users).where(eq(users.id, user.id));

  revalidatePath("/", "layout");
  redirect("/?account=deleted");
}
