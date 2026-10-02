import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
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

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "landlord" | "renter";
  city: string | null;
  bio: string | null;
  createdAt: Date;
};

/** The signed-in user for the current request's cookie, or null. */
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
      role: users.role,
      city: users.city,
      bio: users.bio,
      createdAt: users.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
