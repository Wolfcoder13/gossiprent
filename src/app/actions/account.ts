"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, sanitizeDbError, type Transaction } from "@/db";
import { properties, reviews, sessions, users, type UserRole } from "@/db/schema";
import { getT } from "@/i18n/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { consumeAttempt, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { deleteOtherSessions, deleteSession } from "@/lib/auth/session";
import {
  getProfileReferences,
  isNameLocked,
  isStillReferenced,
  personNameKeys,
  reconcileProfiles,
  type ProfileReferences,
} from "@/lib/people";
import type { FormState } from "@/lib/form-state";
import {
  formValues,
  parseForm,
  passwordChangeSchema,
  profileSchema,
  roleChangeSchema,
  safeRedirectPath,
} from "@/lib/validation";

// Message keys per role (whole sentences; see the writing rules in the dictionaries).
const ROLE_MESSAGES = {
  landlord: {
    reviewedAs: "account.roles.reviewedAs.landlord",
    added: "account.roles.added.landlord",
    removed: "account.roles.removed.landlord",
  },
  renter: {
    reviewedAs: "account.roles.reviewedAs.renter",
    added: "account.roles.added.renter",
    removed: "account.roles.removed.renter",
  },
} as const satisfies Record<UserRole, Record<string, string>>;

/** The signed-in account's row, locked for this transaction; undefined once it's no longer an account. */
async function lockAccount(tx: Transaction, userId: string, strength: "update" | "no key update") {
  const [me] = await tx
    .select({ name: users.name, isLandlord: users.isLandlord, isRenter: users.isRenter })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.passwordHash)))
    .for(strength);
  return me;
}

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("errors.logInAgain") };

  const parsed = parseForm(profileSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const { city, bio } = parsed.data;
  const keys = personNameKeys(parsed.data.name);

  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    // Locked like a review's role grant locks its subject, so a review can't
    // arrive between the check and the rename.
    const me = await lockAccount(tx, user.id, "no key update");
    if (!me) return "gone";
    // Once others have described them by name, only the operator can rename them.
    if (keys.name !== me.name && (await isNameLocked(tx, user.id))) return "locked";
    await tx.update(users).set({ ...keys, city, bio }).where(eq(users.id, user.id));
    return "saved";
  });
  if (result === "gone") return { status: "error", message: t("errors.logInAgain") };
  if (result === "locked") {
    return {
      status: "error",
      message: t("validation.fixHighlighted"),
      fieldErrors: { name: [t("account.profile.nameLocked")] },
      values: formValues(formData),
    };
  }

  revalidatePath("/", "layout");
  return {
    status: "success",
    message: t("account.profile.saved"),
    values: { name: keys.name, city: city ?? "", bio: bio ?? "" },
  };
}

/**
 * Add a role ("I'm also a landlord") or remove one. A role can only be removed
 * while you keep the other one and nobody has reviewed you in it, so dropping
 * a role can't hide reviews. Removing "landlord" unlinks your properties.
 */
export async function changeRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("errors.logInAgain") };
  const parsed = roleChangeSchema.safeParse({
    role: formData.get("role"),
    change: formData.get("change"),
  });
  if (!parsed.success) return { status: "error", message: t("account.roles.invalid") };
  const { role, change } = parsed.data;
  const flag = role === "landlord" ? "isLandlord" : "isRenter";

  const db = await getDb();
  // One transaction holding a lock on the user row, so a review (whose role
  // grant locks its subject) or a property link can't land in between the
  // checks and the change.
  const refusal = await db.transaction(async (tx) => {
    const me = await lockAccount(tx, user.id, "no key update");
    if (!me) return t("errors.logInAgain");
    if (change === "add") {
      await tx.update(users).set({ [flag]: true }).where(eq(users.id, user.id));
      return null;
    }
    if (!(role === "landlord" ? me.isRenter : me.isLandlord)) return t("account.roles.needOne");
    const [reviewed] = await tx
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.subjectUserId, user.id), eq(reviews.kind, role)))
      .limit(1);
    if (reviewed) return t(ROLE_MESSAGES[role].reviewedAs);
    if (role === "landlord") {
      await tx.update(properties).set({ landlordId: null }).where(eq(properties.landlordId, user.id));
    }
    await tx.update(users).set({ [flag]: false }).where(eq(users.id, user.id));
    return null;
  });
  if (refusal) return { status: "error", message: refusal };

  revalidatePath("/", "layout");
  const next = safeRedirectPath(formData.get("next"), "");
  return {
    status: "success",
    message: t(change === "add" ? ROLE_MESSAGES[role].added : ROLE_MESSAGES[role].removed),
    // Came here from a review form? Offer the way back.
    link: change === "add" && next ? { href: next, label: t("account.roles.back") } : undefined,
  };
}

/** Change the password after checking the current one, then sign out other devices. */
export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("errors.logInAgain") };

  const parsed = parseForm(passwordChangeSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const { currentPassword, newPassword } = parsed.data;

  const attempt = await consumeAttempt([
    { key: `password:user:${user.id}`, ...RATE_LIMITS.passwordChangePerUser },
  ]);
  if (attempt.limited) return { status: "error", message: t("errors.tooManyAttempts") };

  const db = await getDb();
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)))
    .limit(1);
  if (!row) return { status: "error", message: t("errors.logInAgain") };
  if (!(await verifyPassword(currentPassword, row.passwordHash!))) {
    return {
      status: "error",
      message: t("validation.fixHighlighted"),
      fieldErrors: { currentPassword: [t("account.password.notCurrent")] },
    };
  }

  const passwordHash = await hashPassword(newPassword);
  try {
    await db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, user.id), isNotNull(users.passwordHash)));
  } catch (error) {
    throw sanitizeDbError(error);
  }
  await deleteOtherSessions(user.id);
  await attempt.release();
  return { status: "success", message: t("account.password.changed") };
}

/** Sign out every other browser/device, keeping this one signed in. */
export async function signOutOtherDevices(): Promise<FormState> {
  const user = await getCurrentUser();
  const t = await getT();
  if (!user) return { status: "error", message: t("errors.logInAgain") };
  await deleteOtherSessions(user.id);
  return { status: "success", message: t("account.password.signedOut") };
}

const hasReferences = (refs: ProfileReferences) =>
  refs.reviewedAsLandlord || refs.reviewedAsRenter || refs.linkedAsLandlord;

/**
 * Close the signed-in user's account.
 *
 * Their login and the reviews they wrote are deleted. Reviews other people
 * wrote *about* them stay, so closing an account can't erase a reputation: if
 * anyone reviewed them, or they're a property's landlord, the row stays as a
 * profile without an account (roles from what refers to it, property links
 * kept). Otherwise it's deleted. Signing up again with the same kennitala
 * takes the profile back.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (formData.get("confirm") !== "delete") return;

  const db = await getDb();
  await db.transaction(async (tx) => {
    // Blocks reviews about them and property links (their role grants lock this
    // row) until this commits; the new statements below see any that came first.
    const me = await lockAccount(tx, user.id, "update");
    if (!me) return;
    const written = await tx
      .delete(reviews)
      .where(eq(reviews.authorId, user.id))
      .returning({ subjectUserId: reviews.subjectUserId });
    await tx.delete(sessions).where(eq(sessions.userId, user.id));

    let refs = (await getProfileReferences(tx, user.id))!;
    let deleted = false;
    if (!hasReferences(refs)) {
      try {
        // A savepoint, so a reference we couldn't see doesn't abort the transaction.
        await tx.transaction(async (savepoint) => {
          await savepoint.delete(users).where(eq(users.id, user.id));
        });
        deleted = true;
      } catch (error) {
        if (!isStillReferenced(error)) throw error;
        refs = (await getProfileReferences(tx, user.id))!;
      }
    }
    if (!deleted) {
      const isLandlord = refs.reviewedAsLandlord || refs.linkedAsLandlord;
      const isRenter = refs.reviewedAsRenter;
      await tx
        .update(users)
        .set({
          email: null,
          passwordHash: null,
          joinedAt: null,
          city: null,
          bio: null,
          // The roles something still shows them in (a profile needs one; if
          // nothing visible explains the reference, keep the roles as they were).
          ...(isLandlord || isRenter ? { isLandlord, isRenter } : {}),
        })
        .where(eq(users.id, user.id));
    }
    // The people they reviewed may now have nothing left that refers to them.
    await reconcileProfiles(
      tx,
      written.map((review) => review.subjectUserId),
    );
  });

  // The session row is gone with the others; this clears the cookie.
  await deleteSession();
  revalidatePath("/", "layout");
  redirect("/?account=deleted");
}
