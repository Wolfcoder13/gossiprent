"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { properties, reviews, sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeAttempt, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { deleteOtherSessions, deleteSession } from "@/lib/auth/session";
import { profilePath } from "@/lib/paths";
import {
  parseForm,
  passwordChangeSchema,
  profileSchema,
  type FormState,
} from "@/lib/validation";

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

/** Change the password after checking the current one, then sign out other devices. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };

  const parsed = parseForm(passwordChangeSchema, formData);
  if (!parsed.success) return parsed.state;
  const { currentPassword, newPassword } = parsed.data;

  const attempt = await consumeAttempt([
    { key: `password:user:${user.id}`, ...RATE_LIMITS.passwordChangePerUser },
  ]);
  if (attempt.limited) {
    return { status: "error", message: "Too many attempts. Please wait a few minutes and try again." };
  }

  const db = await getDb();
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: { currentPassword: ["That isn't your current password."] },
    };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, user.id));
  await deleteOtherSessions(user.id);
  await attempt.release();
  return {
    status: "success",
    message: "Password changed. You've been signed out on your other devices.",
  };
}

/** Sign out every other browser/device, keeping this one signed in. */
export async function signOutOtherDevices(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };
  await deleteOtherSessions(user.id);
  return { status: "success", message: "You've been signed out on all your other devices." };
}

/**
 * Close the signed-in user's account.
 *
 * Reviews they wrote are deleted. Reviews other people wrote *about* them are
 * kept, so closing an account can't be used to erase a bad reputation: the
 * profile stays up, marked as closed, with the email and password wiped. If
 * nobody has reviewed them, the account is deleted outright.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (formData.get("confirm") !== "delete") return;

  const db = await getDb();
  await deleteSession();
  await db.transaction(async (tx) => {
    await tx.delete(reviews).where(eq(reviews.authorId, user.id));
    const [reviewedBySomeone] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(eq(reviews.subjectUserId, user.id))
      .limit(1);

    if (!reviewedBySomeone) {
      await tx.delete(users).where(eq(users.id, user.id));
      return;
    }
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    // Same as the hard delete's ON DELETE SET NULL: their listings become
    // claimable by whoever manages them now.
    await tx.update(properties).set({ landlordId: null }).where(eq(properties.landlordId, user.id));
    await tx
      .update(users)
      .set({
        // Frees the email for a new signup and makes the account unusable.
        email: `deleted-${user.id}@deleted.invalid`,
        passwordHash: "deleted",
        bio: null,
        deletedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  });

  revalidatePath("/", "layout");
  revalidatePath("/properties");
  redirect("/?account=deleted");
}
