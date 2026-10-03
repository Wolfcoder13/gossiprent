import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, pgErrorCode, sanitizeDbError, type Transaction } from "@/db";
import type { Database } from "@/db/connect";
import { properties, propertyDisclaimers, reviews, sessions, users, type UserRole } from "@/db/schema";
import { personNameKeys } from "./text";

/**
 * People and accounts by kennitala. This is the only module that queries
 * `users` by kennitala; everything else works with ids.
 *
 * Every query that sends a kennitala rethrows failures as sanitizeDbError(e):
 * Drizzle puts query parameters in its error messages, and those end up in logs.
 *
 * Locking: the role-granting UPDATEs below are also the lock on the subject's
 * row (NO KEY UPDATE) that a review-writing transaction holds until it commits.
 * reconcileProfiles skips rows locked that way, so it never deletes a profile
 * that someone is in the middle of reviewing; reconcileSkipped retries those
 * after the caller commits. A transaction that locks both a property and a
 * person locks the property first.
 */

// The derived-column rules live in text.ts so the demo-data seed (which can't
// import server-only modules) applies them too.
export { personNameKeys, propertyAddressKeys } from "./text";

/** A database or an open transaction; read-only helpers accept either. */
export type Executor = Database | Transaction;

/** A person or company as the kennitala forms see them. Never includes the kennitala itself. */
export type Person = {
  id: string;
  name: string;
  isLandlord: boolean;
  isRenter: boolean;
  isCompany: boolean;
  hasAccount: boolean;
};

const personColumns = {
  id: users.id,
  name: users.name,
  isLandlord: users.isLandlord,
  isRenter: users.isRenter,
  isCompany: users.isCompany,
  hasAccount: sql<boolean>`${users.passwordHash} is not null`,
};

const roleFlag = (role: UserRole) => (role === "landlord" ? { isLandlord: true } : { isRenter: true });

/**
 * True if a delete failed because a row still refers to the deleted one.
 * Postgres up to 17 reports ON DELETE RESTRICT like any foreign-key violation
 * (23503); Postgres 18 (and the embedded PGlite) report 23001 instead.
 */
export function isStillReferenced(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === "23503" || code === "23001";
}

/** Run a query that sends a kennitala, rethrowing a failure without its parameters. */
async function guarded<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    throw sanitizeDbError(error);
  }
}

/** The person with this kennitala (10 digits, as parseKennitalaInput returns it), if any. */
export async function findPersonByKennitala(kennitala: string, executor?: Executor): Promise<Person | null> {
  const db = executor ?? (await getDb());
  const [person] = await guarded(() =>
    db.select(personColumns).from(users).where(eq(users.kennitala, kennitala)).limit(1),
  );
  return person ?? null;
}

// ensurePerson retries when the row it conflicted with was deleted before it could update it.
const ENSURE_ATTEMPTS = 3;

/**
 * The person with this kennitala, created as a profile without an account if
 * there's none (named as the reviewer typed it), and given `role`. Leaves the
 * row locked until the transaction ends.
 */
export async function ensurePerson(
  tx: Transaction,
  person: { kennitala: string; name: string; isCompany: boolean; role: UserRole },
): Promise<{ id: string; created: boolean }> {
  const { kennitala, isCompany, role } = person;
  for (let attempt = 0; attempt < ENSURE_ATTEMPTS; attempt++) {
    // Two reviewers creating the same person at once: the second insert waits
    // for the first to commit, then does nothing and updates the first one's row.
    const [inserted] = await guarded(() =>
      tx
        .insert(users)
        .values({ kennitala, isCompany, ...personNameKeys(person.name), ...roleFlag(role) })
        .onConflictDoNothing({ target: users.kennitala })
        .returning({ id: users.id }),
    );
    if (inserted) return { id: inserted.id, created: true };

    const [existing] = await guarded(() =>
      tx.update(users).set(roleFlag(role)).where(eq(users.kennitala, kennitala)).returning({ id: users.id }),
    );
    if (existing) return { id: existing.id, created: false };
    // reconcileProfiles deleted the row between the two statements: insert it again.
  }
  throw new Error("ensurePerson: the profile was deleted repeatedly while being created");
}

/** Give the person with this kennitala `role` (locking their row). Null if nobody has it. */
export async function grantRoleByKennitala(
  tx: Transaction,
  kennitala: string,
  role: UserRole,
): Promise<Person | null> {
  const [person] = await guarded(() =>
    tx.update(users).set(roleFlag(role)).where(eq(users.kennitala, kennitala)).returning(personColumns),
  );
  return person ?? null;
}

/**
 * Give profile `id` `role` if `kennitala` is its kennitala (locking the row).
 * False on a mismatch, whether the number is unknown or someone else's; then
 * nothing is written.
 */
export async function grantRoleById(
  tx: Transaction,
  id: string,
  kennitala: string,
  role: UserRole,
): Promise<boolean> {
  const rows = await guarded(() =>
    tx
      .update(users)
      .set(roleFlag(role))
      .where(and(eq(users.id, id), eq(users.kennitala, kennitala)))
      .returning({ id: users.id }),
  );
  return rows.length > 0;
}

/**
 * An account holder's own kennitala: shown on their dashboard, and used to stop
 * them naming themselves as a property's landlord. Null for a profile without one.
 */
export async function getOwnKennitala(userId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await guarded(() =>
    db
      .select({ kennitala: users.kennitala })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.passwordHash)))
      .limit(1),
  );
  return row?.kennitala ?? null;
}

/**
 * True if the holder of this kennitala wrote a review of property `propertyId`.
 * Such a person can't become its landlord (landlords don't review their own
 * property). Lock the property row first so a review can't arrive meanwhile:
 * writing one takes a share lock on it.
 */
export async function hasReviewedProperty(executor: Executor, kennitala: string, propertyId: string): Promise<boolean> {
  const [row] = await guarded(() =>
    executor
      .select({ id: reviews.id })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.authorId))
      .where(and(eq(users.kennitala, kennitala), eq(reviews.propertyId, propertyId)))
      .limit(1),
  );
  return Boolean(row);
}

/**
 * True if the holder of this kennitala said property `propertyId` isn't theirs
 * ("Not my property", or dropping the landlord role). Only they can link
 * themselves to it again, by claiming it.
 */
export async function isDisclaimedLandlord(executor: Executor, kennitala: string, propertyId: string): Promise<boolean> {
  const [row] = await guarded(() =>
    executor
      .select({ userId: propertyDisclaimers.userId })
      .from(propertyDisclaimers)
      .innerJoin(users, eq(users.id, propertyDisclaimers.userId))
      .where(and(eq(users.kennitala, kennitala), eq(propertyDisclaimers.propertyId, propertyId)))
      .limit(1),
  );
  return Boolean(row);
}

// The users row of the surrounding query. Drizzle leaves column names unqualified
// in a single-table select list, and inside a subquery a bare "id" would mean
// the subquery's own table.
const USERS_ID = sql.raw(`"users"."id"`);

/**
 * SQL that is true, for the users row of the surrounding query, once others
 * have described that person by name: someone reviewed them, or they're the
 * landlord of a property someone else added.
 */
function nameLockedSql(): SQL<boolean> {
  // A null creator closed their account, so it was someone else.
  return sql<boolean>`(exists (select 1 from ${reviews} where ${reviews.subjectUserId} = ${USERS_ID})
    or exists (select 1 from ${properties} where ${properties.landlordId} = ${USERS_ID}
      and ${properties.createdById} is distinct from ${USERS_ID}))`;
}

/**
 * True once others have described this person by name (reviewed them, or made
 * them the landlord of a property they added); only the operator can rename
 * them then. Run it after locking the row, as a new statement, so it sees a
 * review or link that was being written meanwhile (they lock the row too).
 */
export async function isNameLocked(executor: Executor, userId: string): Promise<boolean> {
  const [row] = await executor
    .select({ locked: nameLockedSql() })
    .from(users)
    .where(eq(users.id, userId));
  return row?.locked ?? false;
}

/** What still refers to a person, which decides the roles (and existence) of a profile without an account. */
export type ProfileReferences = {
  reviewedAsLandlord: boolean;
  reviewedAsRenter: boolean;
  /** The landlord of at least one property. */
  linkedAsLandlord: boolean;
  /** Wrote reviews (only possible without an account after the operator reset one). */
  wroteReviews: boolean;
};

/**
 * What refers to person `userId` right now (null if there's no such row). Run it
 * in a new statement after locking the row, so it sees everything committed
 * before the lock: reconcileProfiles and closing an account use it.
 */
export async function getProfileReferences(executor: Executor, userId: string): Promise<ProfileReferences | null> {
  const reviewedAs = (kind: UserRole) =>
    sql<boolean>`exists (select 1 from ${reviews} where ${reviews.subjectUserId} = ${USERS_ID} and ${reviews.kind} = ${kind})`;
  const [row] = await executor
    .select({
      reviewedAsLandlord: reviewedAs("landlord"),
      reviewedAsRenter: reviewedAs("renter"),
      linkedAsLandlord: sql<boolean>`exists (select 1 from ${properties} where ${properties.landlordId} = ${USERS_ID})`,
      wroteReviews: sql<boolean>`exists (select 1 from ${reviews} where ${reviews.authorId} = ${USERS_ID})`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/**
 * Bring one locked profile without an account in line with what refers to it
 * (see reconcileProfiles). The caller holds its row lock (FOR UPDATE).
 */
async function reconcileLockedProfile(tx: Transaction, id: string): Promise<void> {
  // New statements, so they see everything committed before the lock was taken.
  const state = await getProfileReferences(tx, id);
  if (!state) return;
  const isLandlord = state.reviewedAsLandlord || state.linkedAsLandlord;
  const isRenter = state.reviewedAsRenter;

  if (isLandlord || isRenter) {
    await tx.update(users).set({ isLandlord, isRenter }).where(eq(users.id, id));
    return;
  }
  if (state.wroteReviews) return;
  await deleteIfUnreferenced(tx, id);
}

/**
 * Delete person `id` inside a savepoint. False, with the caller's transaction
 * intact, if something we couldn't see still refers to them.
 */
async function deleteIfUnreferenced(tx: Transaction, id: string): Promise<boolean> {
  try {
    await tx.transaction(async (savepoint) => {
      await savepoint.delete(users).where(eq(users.id, id));
    });
    return true;
  } catch (error) {
    if (!isStillReferenced(error)) throw error;
    return false;
  }
}

const uniqueIds = (ids: readonly (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/**
 * Bring profiles without an account in line with what still refers to them,
 * after a review about them was deleted or a property link changed: landlord
 * if reviewed as one or linked to a property, renter if reviewed as one, and
 * deleted if neither. Accounts among `ids` are left alone.
 *
 * Rows locked by another transaction are skipped (SKIP LOCKED), so this never
 * waits while the caller holds other locks. The lock holder may be writing a
 * review about them (a reason to keep the row), but it may also be another
 * reconciler removing their last reference, which would then still see ours.
 * So the skipped ids are returned: pass them to reconcileSkipped once the
 * caller's transaction has committed.
 *
 * A profile that wrote reviews (an account the operator reset) is never deleted:
 * that would delete its reviews of other people with it.
 */
export async function reconcileProfiles(
  tx: Transaction,
  ids: readonly (string | null | undefined)[],
): Promise<string[]> {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return [];

  const withoutAccount = and(inArray(users.id, unique), isNull(users.passwordHash));
  // Who to reconcile, without locking: the ones we then fail to lock were skipped.
  const candidates = await tx.select({ id: users.id }).from(users).where(withoutAccount).orderBy(users.id);
  if (candidates.length === 0) return [];
  const locked = await tx
    .select({ id: users.id })
    .from(users)
    .where(withoutAccount)
    .orderBy(users.id)
    .for("update", { skipLocked: true });

  for (const { id } of locked) await reconcileLockedProfile(tx, id);
  const lockedIds = new Set(locked.map((row) => row.id));
  return candidates.map((row) => row.id).filter((id) => !lockedIds.has(id));
}

/**
 * Reconcile the profiles reconcileProfiles skipped, after the caller's
 * transaction has committed (pass its return value; [] does nothing). Runs a
 * short transaction of its own that waits for each row's lock, taken in id
 * order and with no other locks held, so it can't deadlock; once it has the
 * lock it sees whatever the holder committed (a new review keeps the profile,
 * another reconciler's deletion of the last reference removes it).
 *
 * `db` defaults to the app's database; scripts pass their own.
 */
export async function reconcileSkipped(ids: readonly string[], db?: Database): Promise<void> {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return;
  const database = db ?? (await getDb());
  await database.transaction(async (tx) => {
    const locked = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, unique), isNull(users.passwordHash)))
      .orderBy(users.id)
      .for("update");
    for (const { id } of locked) await reconcileLockedProfile(tx, id);
  });
}

/**
 * Remove an account's login but keep what others wrote about them: closing an
 * account (deleteAccount) and the operator's reset-account. Locks the row FOR
 * UPDATE (waiting for reviews and property links in progress, whose role grants
 * lock it) and deletes its sessions.
 *
 * Then, in new statements that see everything committed before the lock: if
 * nothing refers to the row and it wrote no reviews, the row is deleted
 * ("deleted"). Otherwise it stays as a profile without an account ("kept"):
 * email, password, joined date, city and bio cleared, roles as for any such
 * profile (landlord if reviewed as one or linked to a property, renter if
 * reviewed as one). If neither applies (it only wrote reviews), the roles stay
 * as they were, since a profile needs one.
 *
 * Throws if `userId` isn't an account; callers check that first.
 */
export async function detachAccount(tx: Transaction, userId: string): Promise<"deleted" | "kept"> {
  const [account] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNotNull(users.passwordHash)))
    .for("update");
  if (!account) throw new Error("detachAccount: not an account");
  await tx.delete(sessions).where(eq(sessions.userId, userId));

  let refs = (await getProfileReferences(tx, userId))!;
  const referenced = (r: ProfileReferences) => r.reviewedAsLandlord || r.reviewedAsRenter || r.linkedAsLandlord;
  if (!referenced(refs) && !refs.wroteReviews) {
    if (await deleteIfUnreferenced(tx, userId)) return "deleted";
    // Something we couldn't see refers to it: keep it, with the roles that explains.
    refs = (await getProfileReferences(tx, userId))!;
  }

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
      ...(isLandlord || isRenter ? { isLandlord, isRenter } : {}),
    })
    .where(eq(users.id, userId));
  return "kept";
}
