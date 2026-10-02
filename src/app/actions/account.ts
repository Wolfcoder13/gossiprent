"use server";

import { and, eq } from "drizzle-orm";
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
  roleChangeSchema,
  safeRedirectPath,
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

/**
 * Add a role ("I'm also a landlord") or remove one. A role can only be removed
 * while you keep the other one and nobody has reviewed you in it, so dropping
 * a role can't hide reviews. Removing "landlord" unlinks your properties.
 */
export async function changeRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in again." };
  const parsed = roleChangeSchema.safeParse({
    role: formData.get("role"),
    change: formData.get("change"),
  });
  if (!parsed.success) return { status: "error", message: "Something went wrong. Please try again." };
  const { role, change } = parsed.data;
  const flag = role === "landlord" ? "isLandlord" : "isRenter";
  const label = role === "landlord" ? "landlord" : "renter";

  const db = await getDb();
  if (change === "add") {
    await db.update(users).set({ [flag]: true }).where(eq(users.id, user.id));
  } else {
    // One transaction holding a lock on the user row, so a review (which
    // share-locks its subject) or a property claim can't land in between the
    // checks and the removal.
    const refusal = await db.transaction(async (tx) => {
      const [me] = await tx
        .select({ isLandlord: users.isLandlord, isRenter: users.isRenter })
        .from(users)
        .where(eq(users.id, user.id))
        // Blocks the FOR SHARE locks taken by reviews, claims and new listings,
        // but not foreign-key checks (which would risk deadlocks).
        .for("no key update");
      if (!me) return "Please log in again.";
      if (!(role === "landlord" ? me.isRenter : me.isLandlord)) {
        return "You need at least one role. Add the other one first.";
      }
      const [reviewed] = await tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.subjectUserId, user.id), eq(reviews.kind, role)))
        .limit(1);
      if (reviewed) return `People have reviewed you as a ${label}, so you can't remove that role.`;
      if (role === "landlord") {
        await tx.update(properties).set({ landlordId: null }).where(eq(properties.landlordId, user.id));
      }
      await tx.update(users).set({ [flag]: false }).where(eq(users.id, user.id));
      return null;
    });
    if (refusal) return { status: "error", message: refusal };
  }

  revalidatePath("/", "layout");
  const next = safeRedirectPath(formData.get("next"), "");
  return {
    status: "success",
    message:
      change === "add"
        ? `Done. You're now listed as a ${label} too.`
        : `Done. You're no longer listed as a ${label}.`,
    // Came here from a review form? Offer the way back.
    link: change === "add" && next ? { href: next, label: "Back to write your review" } : undefined,
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
    // Lock the row so a review about them can't arrive mid-way.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    await tx.delete(reviews).where(eq(reviews.authorId, user.id));
    const reviewedAs = (
      await tx
        .selectDistinct({ kind: reviews.kind })
        .from(reviews)
        .where(eq(reviews.subjectUserId, user.id))
    ).map((row) => row.kind);

    if (reviewedAs.length === 0) {
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
        // Keep only the roles they were reviewed in; the rest has nothing to show.
        isLandlord: reviewedAs.includes("landlord"),
        isRenter: reviewedAs.includes("renter"),
      })
      .where(eq(users.id, user.id));
  });

  revalidatePath("/", "layout");
  revalidatePath("/properties");
  redirect("/?account=deleted");
}
