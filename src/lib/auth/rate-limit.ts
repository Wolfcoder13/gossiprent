import "server-only";
import { and, count, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { authAttempts } from "@/db/schema";

export type RateLimit = {
  /** e.g. "login:account:jo@example.com" or "kt:user15:<uuid>". Never contains a kennitala. */
  key: string;
  /** Attempts allowed within the window. */
  max: number;
  windowMs: number;
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// The longest window below; older attempts no longer count against anything.
const PRUNE_AFTER_MS = DAY;

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
  // Looking a kennitala up (wizard, property form, lookup, profile-page review)
  // reveals whether someone with that number has been reviewed, so it's limited
  // per account in a short and a long window, and per network. There is no
  // per-profile limit: one shared by everyone would let a single account block
  // all new reviews of a profile by filling it with wrong numbers.
  kennitalaChecksPerUser: { max: 10, windowMs: 15 * MINUTE },
  kennitalaChecksPerUserDaily: { max: 50, windowMs: DAY },
  kennitalaChecksPerIp: { max: 100, windowMs: DAY },
  newReviewsPerAuthor: { max: 20, windowMs: DAY },
  // Profiles without an account, created by reviewing or linking a new kennitala.
  newProfilesPerAuthor: { max: 5, windowMs: DAY },
  reportsPerUser: { max: 10, windowMs: DAY },
  reportsPerIp: { max: 20, windowMs: DAY },
} as const;

/** Limits for one kennitala check by a signed-in user (`ip` from clientIp(); null = unknown). */
export function kennitalaCheckLimits(userId: string, ip: string | null): RateLimit[] {
  return [
    { key: `kt:user15:${userId}`, ...RATE_LIMITS.kennitalaChecksPerUser },
    { key: `kt:userday:${userId}`, ...RATE_LIMITS.kennitalaChecksPerUserDaily },
    ...(ip ? [{ key: `kt:ip:${ip}`, ...RATE_LIMITS.kennitalaChecksPerIp }] : []),
  ];
}

/** Limit for writing a new review (not for editing one). */
export function newReviewLimits(userId: string): RateLimit[] {
  return [{ key: `review-new:user:${userId}`, ...RATE_LIMITS.newReviewsPerAuthor }];
}

/** Limit for creating a profile without an account (a review or property link to a new kennitala). */
export function newProfileLimits(userId: string): RateLimit[] {
  return [{ key: `profile-new:user:${userId}`, ...RATE_LIMITS.newProfilesPerAuthor }];
}

/** Limits for sending a report, signed in (`userId`) or not (null). */
export function reportLimits(userId: string | null, ip: string | null): RateLimit[] {
  return [
    ...(userId ? [{ key: `report:user:${userId}`, ...RATE_LIMITS.reportsPerUser }] : []),
    ...(ip ? [{ key: `report:ip:${ip}`, ...RATE_LIMITS.reportsPerIp }] : []),
  ];
}

/**
 * The visitor's IP address, or null if unknown. Vercel sets these headers
 * itself, so clients can't fake them there. Anywhere else a client could send
 * its own X-Forwarded-For, so they're only trusted when TRUST_PROXY_HEADERS=true
 * (set it when you run behind a proxy that overwrites them). Without a
 * trustworthy IP, the IP-based limits are skipped; per-account limits still apply.
 */
export async function clientIp(): Promise<string | null> {
  if (!process.env.VERCEL && process.env.TRUST_PROXY_HEADERS !== "true") return null;
  const h = await headers();
  return (
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

type Attempt = {
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
