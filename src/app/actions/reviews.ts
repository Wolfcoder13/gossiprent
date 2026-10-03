"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, pgErrorCode, type Transaction } from "@/db";
import { properties, reviews, users, type ReviewKind } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/data";
import { subjectPath } from "@/lib/paths";
import { hasRole, reviewerRole } from "@/lib/roles";
import { parseForm, reviewSchema, type FormState } from "@/lib/validation";

type ResolvedTarget =
  | { ok: true; subjectUserId: string | null; propertyId: string | null; path: string }
  | { ok: false; message: string };

/**
 * Check that `user` may review this subject, and that it exists. Runs inside
 * the transaction that writes the review and share-locks the subject's row, so
 * a concurrent "remove role" or "claim property" can't slip in between the
 * check and the write.
 */
async function resolveTarget(
  tx: Transaction,
  user: SessionUser,
  kind: ReviewKind,
  subjectId: string,
): Promise<ResolvedTarget> {
  // Lock order: author, then subject. A key-share lock waits for an account
  // being closed, without blocking role changes.
  const [author] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, user.id), isNull(users.deletedAt)))
    .for("key share");
  if (!author) return { ok: false, message: "Please log in again." };

  if (kind === "property") {
    if (!user.isRenter) {
      return { ok: false, message: "Only renters can review properties." };
    }
    const [property] = await tx
      .select({ id: properties.id, landlordId: properties.landlordId })
      .from(properties)
      .where(eq(properties.id, subjectId))
      .limit(1)
      .for("share");
    if (!property) return { ok: false, message: "That property no longer exists." };
    if (property.landlordId === user.id) {
      return { ok: false, message: "You can't review a property you manage." };
    }
    return {
      ok: true,
      subjectUserId: null,
      propertyId: property.id,
      path: subjectPath(kind, property.id),
    };
  }

  // Renters review landlords; landlords review renters.
  if (!hasRole(user, reviewerRole(kind))) {
    return {
      ok: false,
      message:
        kind === "landlord"
          ? "Only renters can review landlords."
          : "Only landlords can review renters.",
    };
  }
  if (subjectId === user.id) {
    return { ok: false, message: "You can't review yourself." };
  }
  const [subject] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, subjectId),
        eq(kind === "landlord" ? users.isLandlord : users.isRenter, true),
      ),
    )
    .limit(1)
    .for("share");
  if (!subject) return { ok: false, message: `That ${kind} no longer exists.` };
  return {
    ok: true,
    subjectUserId: subject.id,
    propertyId: null,
    path: subjectPath(kind, subject.id),
  };
}

function revalidateReviewPages(path: string) {
  revalidatePath(path);
  revalidatePath("/");
  revalidatePath("/dashboard");
  revalidatePath(path.slice(0, path.lastIndexOf("/"))); // the directory listing
}

/** Create the signed-in user's review of a subject, or update it if they already wrote one. */
export async function saveReview(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", message: "Please log in to leave a review." };

  const parsed = parseForm(reviewSchema, formData);
  if (!parsed.success) return parsed.state;
  const { kind, subjectId, rating, title, body } = parsed.data;

  const db = await getDb();
  const result = await db.transaction(async (tx) => {
    const target = await resolveTarget(tx, user, kind, subjectId);
    if (!target.ok) return target;

    const mine = and(
      eq(reviews.authorId, user.id),
      target.propertyId
        ? eq(reviews.propertyId, target.propertyId)
        : and(eq(reviews.subjectUserId, target.subjectUserId!), eq(reviews.kind, kind)),
    );
    const update = () =>
      tx
        .update(reviews)
        .set({ rating, title, body, updatedAt: new Date() })
        .where(mine)
        .returning({ id: reviews.id });

    let updated = (await update()).length > 0;
    if (!updated) {
      try {
        // A savepoint, so a duplicate-key error doesn't abort the whole transaction.
        await tx.transaction(async (savepoint) => {
          await savepoint.insert(reviews).values({
            kind,
            authorId: user.id,
            subjectUserId: target.subjectUserId,
            propertyId: target.propertyId,
            rating,
            title,
            body,
          });
        });
      } catch (error) {
        // A double-submit raced us to the insert; keep the latest text instead.
        if (pgErrorCode(error) !== "23505") throw error;
        await update();
        updated = true;
      }
    }
    return { ok: true as const, path: target.path, updated };
  });
  if (!result.ok) return { status: "error", message: result.message };

  revalidateReviewPages(result.path);
  return {
    status: "success",
    message: result.updated ? "Your review was updated." : "Thanks! Your review is live.",
  };
}

/** Delete one of the signed-in user's own reviews. */
export async function deleteReview(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  const reviewId = formData.get("reviewId");
  if (!user || typeof reviewId !== "string" || !isUuid(reviewId)) return;

  const db = await getDb();
  const [deleted] = await db
    .delete(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.authorId, user.id)))
    .returning({
      kind: reviews.kind,
      subjectUserId: reviews.subjectUserId,
      propertyId: reviews.propertyId,
    });
  if (!deleted) return;

  revalidateReviewPages(subjectPath(deleted.kind, (deleted.propertyId ?? deleted.subjectUserId)!));
}
