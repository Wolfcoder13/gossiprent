import "server-only";
import { and, count, eq, gt, inArray, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { authAttempts } from "@/db/schema";

export type RateLimit = {
  /** e.g. "login:email:jo@example.com" or "signup:ip:203.0.113.7" */
  key: string;
  /** Attempts allowed within the window. */
  max: number;
  windowMs: number;
};

const MINUTE = 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * MINUTE;

// Escape hatch for automated test runs that create many accounts from one IP.
const disabled = () => process.env.AUTH_RATE_LIMIT === "off";

export const RATE_LIMITS = {
  loginPerEmail: { max: 10, windowMs: 15 * MINUTE },
  loginPerIp: { max: 50, windowMs: 15 * MINUTE },
  signupPerIp: { max: 20, windowMs: 60 * MINUTE },
  passwordChangePerUser: { max: 10, windowMs: 15 * MINUTE },
} as const;

/**
 * The visitor's IP address. On Vercel these headers are set by the platform
 * (and can't be spoofed by the client). Elsewhere they may be missing, in which
 * case every visitor shares one bucket and only per-email limits really apply.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** True if any limit has already been reached within its window. */
export async function isRateLimited(limits: RateLimit[]): Promise<boolean> {
  if (disabled()) return false;
  const db = await getDb();
  const now = Date.now();
  const counts = await Promise.all(
    limits.map((limit) =>
      db
        .select({ n: count() })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.key, limit.key),
            gt(authAttempts.createdAt, new Date(now - limit.windowMs)),
          ),
        ),
    ),
  );
  return counts.some(([row], i) => row.n >= limits[i].max);
}

/** Count one attempt against each key. */
export async function recordAttempt(keys: string[]): Promise<void> {
  if (disabled()) return;
  const db = await getDb();
  await db.insert(authAttempts).values(keys.map((key) => ({ key })));
  // Keep the table small without a cron job: now and then, drop old rows.
  if (Math.random() < 0.05) {
    await db
      .delete(authAttempts)
      .where(lt(authAttempts.createdAt, new Date(Date.now() - PRUNE_AFTER_MS)));
  }
}

/** Forget attempts for these keys (e.g. after a successful login). */
export async function clearAttempts(keys: string[]): Promise<void> {
  const db = await getDb();
  await db.delete(authAttempts).where(inArray(authAttempts.key, keys));
}
