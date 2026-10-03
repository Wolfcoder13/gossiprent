import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, sanitizeDbError } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "gossiprent_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Start a session for `userId` and set the session cookie. Call from Server Actions.
 *
 * With `expectedHash` (the password hash that was just checked), the session is
 * only stored if that is still the account's password: a login that checked the
 * password before the account was closed, reset by the operator or given a new
 * password can't leave a session behind. Returns whether a session was started
 * (no cookie is set otherwise).
 */
export async function createSession(userId: string, options: { expectedHash?: string } = {}): Promise<boolean> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Opportunistically clear this user's expired sessions.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  const { expectedHash } = options;
  if (expectedHash === undefined) {
    await db.insert(sessions).values({ id, userId, expiresAt });
  } else {
    let inserted: unknown[];
    try {
      inserted = await db
        .insert(sessions)
        .select(
          db
            .select({
              id: sql<string>`${id}::text`.as("id"),
              userId: users.id,
              expiresAt: sql<Date>`${expiresAt.toISOString()}::timestamptz`.as("expires_at"),
              createdAt: sql<Date>`now()`.as("created_at"),
            })
            .from(users)
            .where(and(eq(users.id, userId), eq(users.passwordHash, expectedHash))),
        )
        .returning({ id: sessions.id });
    } catch (error) {
      // The query carries the password hash; keep it out of logs.
      throw sanitizeDbError(error);
    }
    if (inserted.length === 0) return false;
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

/** End the current session (if any) and clear the cookie. Call from Server Actions. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Sign the user out everywhere except this browser (e.g. after a password change). */
export async function deleteOtherSessions(userId: string): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const db = await getDb();
  await db
    .delete(sessions)
    .where(
      token
        ? and(eq(sessions.userId, userId), ne(sessions.id, hashToken(token)))
        : eq(sessions.userId, userId),
    );
}

/** The signed-in account. Never carries the kennitala (see getOwnKennitala in src/lib/people.ts). */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  isLandlord: boolean;
  isRenter: boolean;
  city: string | null;
  bio: string | null;
};

/**
 * The signed-in user for the current request's cookie, or null. Only accounts
 * can have a session: closing one clears its password hash (and its sessions).
 * A session older than the account (joined_at is reset when signup takes over
 * a profile) never counts, so one left on the row can't come back to life.
 */
export async function readSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isLandlord: users.isLandlord,
      isRenter: users.isRenter,
      city: users.city,
      bio: users.bio,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNotNull(users.passwordHash),
        gte(sessions.createdAt, users.joinedAt),
      ),
    )
    .limit(1);
  // An account always has an email (users_account_complete).
  return row ? { ...row, email: row.email! } : null;
}
