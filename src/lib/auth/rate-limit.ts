import "server-only";
import { and, count, eq, gt, inArray, lt, sql } from "drizzle-orm";
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
  // Guessing one account's password from one network.
  loginPerAccountAndIp: { max: 10, windowMs: 15 * MINUTE },
  // Backstop against guessing one account from many networks. Kept well above
  // the per-network limit so a stranger can't easily lock the owner out.
  loginPerAccount: { max: 100, windowMs: 15 * MINUTE },
  // One network trying many accounts.
  loginPerIp: { max: 50, windowMs: 15 * MINUTE },
  signupPerIp: { max: 20, windowMs: 60 * MINUTE },
  passwordChangePerUser: { max: 10, windowMs: 15 * MINUTE },
} as const;

/**
 * The visitor's IP address, or null if unknown. On Vercel these headers are
 * set by the platform and can't be spoofed by the client. Without a proxy that
 * sets them, IP-based limits are skipped rather than lumping every visitor
 * into one shared bucket.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

export type Attempt = {
  /** True if this attempt went over at least one limit (and was not counted). */
  limited: boolean;
  /** Un-count this attempt, e.g. after a successful login. */
  release: () => Promise<void>;
};

/**
 * Count one attempt against each limit and report whether any is exceeded.
 *
 * The attempt is written *before* counting, so a burst of concurrent requests
 * can't all see "under the limit" at once: the n-th request to be recorded
 * always counts at least n attempts. A rejected attempt is removed again, so
 * being blocked doesn't extend the block.
 */
export async function consumeAttempt(limits: RateLimit[]): Promise<Attempt> {
  if (disabled() || limits.length === 0) {
    return { limited: false, release: async () => {} };
  }
  const db = await getDb();
  const inserted = await db
    .insert(authAttempts)
    .values(limits.map((limit) => ({ key: limit.key })))
    .returning({ id: authAttempts.id });
  const ids = inserted.map((row) => row.id);
  const release = async () => {
    await db.delete(authAttempts).where(inArray(authAttempts.id, ids));
  };

  const counts = await Promise.all(
    limits.map((limit) =>
      db
        .select({ n: count() })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.key, limit.key),
            // Database time on both sides, so app/DB clock skew doesn't matter.
            gt(authAttempts.createdAt, sql`now() - ${limit.windowMs}::int * interval '1 millisecond'`),
          ),
        ),
    ),
  );
  // ">" rather than ">=": the count includes this attempt.
  const limited = counts.some(([row], i) => row.n > limits[i].max);
  if (limited) await release();

  // Keep the table small without a cron job: now and then, drop old rows.
  if (Math.random() < 0.05) {
    await db
      .delete(authAttempts)
      .where(lt(authAttempts.createdAt, sql`now() - ${PRUNE_AFTER_MS}::int * interval '1 millisecond'`));
  }
  return { limited, release };
}

/** Forget all attempts for these keys (e.g. a network's failures after it logs in). */
export async function clearAttempts(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await getDb();
  await db.delete(authAttempts).where(inArray(authAttempts.key, keys));
}
