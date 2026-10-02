"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, pgErrorCode } from "@/db";
import { properties, reviews, users, type ReviewKind } from "@/db/schema";
import { getCurrentUser, type SessionUser } from "@/lib/auth/current-user";
import { isUuid } from "@/lib/data";
import { subjectPath } from "@/lib/paths";
import { parseForm, reviewSchema, type FormState } from "@/lib/validation";

type ResolvedTarget =
  | { ok: true; subjectUserId: string | null; propertyId: string | null; path: string }
  | { ok: false; message: string };

/** Check that `user` is allowed to review this subject, and that it exists. */
async function resolveTarget(
  user: SessionUser,
  kind: ReviewKind,
  subjectId: string,
): Promise<ResolvedTarget> {
  const db = await getDb();

  if (kind === "property") {
    if (user.role !== "renter") {
      return { ok: false, message: "Only renters can review properties." };
    }
    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, subjectId))
      .limit(1);
    if (!property) return { ok: false, message: "That property no longer exists." };
    return {
      ok: true,
      subjectUserId: null,
      propertyId: property.id,
      path: subjectPath(kind, property.id),
    };
  }

  // Renters review landlords; landlords review renters.
  const requiredAuthorRole = kind === "landlord" ? "renter" : "landlord";
  if (user.role !== requiredAuthorRole) {
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
  const [subject] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, subjectId), eq(users.role, kind)))
    .limit(1);
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

  const target = await resolveTarget(user, kind, subjectId);
  if (!target.ok) return { status: "error", message: target.message };

  const db = await getDb();
  const mine = and(
    eq(reviews.authorId, user.id),
    target.propertyId
      ? eq(reviews.propertyId, target.propertyId)
      : eq(reviews.subjectUserId, target.subjectUserId!),
  );
  const update = () =>
    db
      .update(reviews)
      .set({ rating, title, body, updatedAt: new Date() })
      .where(mine)
      .returning({ id: reviews.id });

  let updated = (await update()).length > 0;
  if (!updated) {
    try {
      await db.insert(reviews).values({
        kind,
        authorId: user.id,
        subjectUserId: target.subjectUserId,
        propertyId: target.propertyId,
        rating,
        title,
        body,
      });
    } catch (error) {
      // A double-submit raced us to the insert; keep the latest text instead.
      if (pgErrorCode(error) !== "23505") throw error;
      await update();
      updated = true;
    }
  }

  revalidateReviewPages(target.path);
  return {
    status: "success",
    message: updated ? "Your review was updated." : "Thanks! Your review is live.",
    values: { rating: String(rating), title, body },
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
