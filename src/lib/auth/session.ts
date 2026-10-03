import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, lt, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";

export const SESSION_COOKIE = "gossiprent_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Start a session for `userId` and set the session cookie. Call from Server Actions. */
export async function createSession(userId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Opportunistically clear this user's expired sessions.
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
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
  isCompany: boolean;
  city: string | null;
  bio: string | null;
};

/**
 * The signed-in user for the current request's cookie, or null. Only accounts
 * can have a session: closing one clears its password hash (and its sessions).
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
      isCompany: users.isCompany,
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
      ),
    )
    .limit(1);
  // An account always has an email (users_account_complete).
  return row ? { ...row, email: row.email! } : null;
}
