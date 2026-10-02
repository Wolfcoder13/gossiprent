import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A throwaway embedded database just for this file. It must be configured
// before "@/db" connects (which happens lazily, on the first getDb() call).
const testDb = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gossiprent-unit-rate-limit-"));
  process.env.PGLITE_DATA_DIR = path.join(root, "pglite");
  process.env.SEED_DEMO_DATA = "false";
  // UNIT_DATABASE_URL runs this file against a real Postgres instead (a freshly
  // migrated database used only for tests), e.g. to check the rate limiter
  // under real concurrency with a connection pool.
  process.env.DATABASE_URL = process.env.UNIT_DATABASE_URL ?? "";
  process.env.POSTGRES_URL = "";
  process.env.VERCEL = "";
  delete process.env.AUTH_RATE_LIMIT;
  // These tests play the part of a reverse proxy that sets X-Real-IP /
  // X-Forwarded-For, so trust those headers (see clientIp).
  process.env.TRUST_PROXY_HEADERS = "true";
  return { root, postgres: Boolean(process.env.UNIT_DATABASE_URL) };
});

// The request headers that `clientIp()` reads through next/headers.
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => {
    throw new Error("cookies() isn't used by the rate limiter");
  },
}));

import fs from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { closeDatabase } from "@/db/connect";
import { authAttempts } from "@/db/schema";
import {
  clearAttempts,
  clientIp,
  consumeAttempt,
  RATE_LIMITS,
  type RateLimit,
} from "@/lib/auth/rate-limit";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

let keyCounter = 0;
/** A key no other test uses, so tests don't see each other's attempts. */
function freshKey(prefix = "test"): string {
  keyCounter += 1;
  return `${prefix}:${keyCounter}:${Math.random().toString(36).slice(2, 8)}`;
}

const limit = (key: string, max = 3, windowMs = 15 * MINUTE): RateLimit => ({ key, max, windowMs });

async function attemptsFor(key: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ id: authAttempts.id }).from(authAttempts).where(eq(authAttempts.key, key));
  return rows.length;
}

/** Insert attempts with explicit timestamps (e.g. ones made a while ago). */
async function insertAttemptsAt(key: string, agesMs: number[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.insert(authAttempts).values(agesMs.map((age) => ({ key, createdAt: new Date(now - age) })));
}

/** `times` recent attempts for `key`, written straight to the table. */
async function seedAttempts(key: string, times: number): Promise<void> {
  if (times > 0) await insertAttemptsAt(key, Array.from({ length: times }, () => 0));
}

/** Consume `times` attempts one after another; returns how many were limited. */
async function consumeTimes(limits: RateLimit[], times: number): Promise<number> {
  let limited = 0;
  for (let i = 0; i < times; i++) if ((await consumeAttempt(limits)).limited) limited += 1;
  return limited;
}

beforeAll(async () => {
  // Opens the database and runs the migrations (incl. the auth_attempts table).
  await getDb();
}, 60_000);

afterAll(async () => {
  const holder = globalThis as typeof globalThis & { __gossiprentDb?: Promise<unknown> };
  if (holder.__gossiprentDb) {
    await closeDatabase(await getDb());
    holder.__gossiprentDb = undefined;
  }
  fs.rmSync(testDb.root, { recursive: true, force: true });
});

beforeEach(() => {
  request.headers = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.skipIf(testDb.postgres)("the test database", () => {
  it("is a fresh, empty embedded database (no demo data)", async () => {
    const db = await getDb();
    const { users } = await import("@/db/schema");
    expect(await db.select({ id: users.id }).from(users)).toEqual([]);
    expect(fs.existsSync(process.env.PGLITE_DATA_DIR!)).toBe(true);
  });
});

describe("RATE_LIMITS", () => {
  it("has the documented limits", () => {
    expect(RATE_LIMITS).toEqual({
      loginPerAccountAndIp: { max: 10, windowMs: 15 * MINUTE },
      loginPerAccount: { max: 100, windowMs: 15 * MINUTE },
      loginPerIp: { max: 50, windowMs: 15 * MINUTE },
      signupPerIp: { max: 20, windowMs: HOUR },
      passwordChangePerUser: { max: 10, windowMs: 15 * MINUTE },
    });
  });

  it("keeps the per-account backstop well above the per-network limit", () => {
    // Otherwise a stranger could lock the owner out from a single network.
    expect(RATE_LIMITS.loginPerAccount.max).toBeGreaterThanOrEqual(5 * RATE_LIMITS.loginPerAccountAndIp.max);
  });
});

describe("clientIp", () => {
  it("uses x-real-ip first", async () => {
    request.headers = new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(await clientIp()).toBe("203.0.113.7");
  });

  it("trims x-real-ip", async () => {
    request.headers = new Headers({ "x-real-ip": "  203.0.113.8  " });
    expect(await clientIp()).toBe("203.0.113.8");
  });

  it("falls back to the first (client) address in x-forwarded-for", async () => {
    request.headers = new Headers({ "x-forwarded-for": " 198.51.100.2 , 10.0.0.1, 10.0.0.2" });
    expect(await clientIp()).toBe("198.51.100.2");
  });

  it("ignores a blank x-real-ip", async () => {
    request.headers = new Headers({ "x-real-ip": "   ", "x-forwarded-for": "198.51.100.3" });
    expect(await clientIp()).toBe("198.51.100.3");
  });

  it("is null without either header (or with blank ones)", async () => {
    expect(await clientIp()).toBeNull();
    request.headers = new Headers({ "x-real-ip": "", "x-forwarded-for": " , 10.0.0.1" });
    expect(await clientIp()).toBeNull();
    request.headers = new Headers({ "x-real-ip": "  ", "x-forwarded-for": "  " });
    expect(await clientIp()).toBeNull();
  });

  it("supports IPv6 addresses", async () => {
    request.headers = new Headers({ "x-real-ip": "2001:db8::1" });
    expect(await clientIp()).toBe("2001:db8::1");
  });

  describe("which headers are trusted", () => {
    afterEach(() => {
      process.env.TRUST_PROXY_HEADERS = "true";
      process.env.VERCEL = "";
    });

    it("ignores them when self-hosting without TRUST_PROXY_HEADERS (a client could fake them)", async () => {
      request.headers = new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.9" });
      for (const value of [undefined, "", "false", "1", "TRUE"]) {
        if (value === undefined) delete process.env.TRUST_PROXY_HEADERS;
        else process.env.TRUST_PROXY_HEADERS = value;
        expect(await clientIp(), `TRUST_PROXY_HEADERS=${value}`).toBeNull();
      }
    });

    it("trusts them on Vercel, which sets them itself", async () => {
      delete process.env.TRUST_PROXY_HEADERS;
      process.env.VERCEL = "1";
      request.headers = new Headers({ "x-real-ip": "203.0.113.10" });
      expect(await clientIp()).toBe("203.0.113.10");
    });
  });
});

describe("consumeAttempt", () => {
  it("allows a key with no attempts, and counts this one", async () => {
    const key = freshKey();
    const attempt = await consumeAttempt([limit(key)]);
    expect(attempt.limited).toBe(false);
    expect(await attemptsFor(key)).toBe(1);
  });

  it("records one attempt per limit, each under its own key", async () => {
    const a = freshKey();
    const b = freshKey();
    await consumeAttempt([limit(a), limit(b)]);
    expect(await attemptsFor(a)).toBe(1);
    expect(await attemptsFor(b)).toBe(1);
    await consumeAttempt([limit(a)]);
    expect(await attemptsFor(a)).toBe(2);
    expect(await attemptsFor(b)).toBe(1);
  });

  it("with no limits, allows everything and writes nothing", async () => {
    const db = await getDb();
    const before = (await db.select({ id: authAttempts.id }).from(authAttempts)).length;
    const attempt = await consumeAttempt([]);
    expect(attempt.limited).toBe(false);
    await attempt.release();
    expect((await db.select({ id: authAttempts.id }).from(authAttempts)).length).toBe(before);
  });

  it("allows exactly `max` attempts and limits the next one", async () => {
    const key = freshKey();
    for (let i = 1; i <= 3; i++) {
      expect((await consumeAttempt([limit(key, 3)])).limited, `attempt ${i}`).toBe(false);
    }
    expect((await consumeAttempt([limit(key, 3)])).limited).toBe(true);
    expect((await consumeAttempt([limit(key, 3)])).limited).toBe(true);
  });

  it("doesn't count limited attempts, so being blocked doesn't extend the block", async () => {
    const key = freshKey();
    await seedAttempts(key, 3);
    expect(await consumeTimes([limit(key, 3)], 5)).toBe(5);
    expect(await attemptsFor(key)).toBe(3);
  });

  it("uses the real limits: 10 logins per account and network, the 11th is limited", async () => {
    const key = `login:account-ip:${freshKey()}@example.com|203.0.113.9`;
    const limits = [{ key, ...RATE_LIMITS.loginPerAccountAndIp }];
    expect(await consumeTimes(limits, 10)).toBe(0);
    expect((await consumeAttempt(limits)).limited).toBe(true);
  });

  it("uses the real limits: 100 logins per account, the 101st is limited", async () => {
    const key = `login:account:${freshKey()}@example.com`;
    const limits = [{ key, ...RATE_LIMITS.loginPerAccount }];
    await seedAttempts(key, 99);
    expect((await consumeAttempt(limits)).limited).toBe(false);
    expect((await consumeAttempt(limits)).limited).toBe(true);
  });

  it("only counts attempts inside the window", async () => {
    const key = freshKey();
    // Three attempts, but two are older than the 15-minute window.
    await insertAttemptsAt(key, [16 * MINUTE, 60 * MINUTE, 1 * MINUTE]);
    // 1 recent + this one = 2: allowed with max 2 (then released, to keep the setup).
    let attempt = await consumeAttempt([limit(key, 2, 15 * MINUTE)]);
    expect(attempt.limited).toBe(false);
    await attempt.release();
    // A wider window sees all three, plus this one.
    attempt = await consumeAttempt([limit(key, 3, 2 * HOUR)]);
    expect(attempt.limited).toBe(true);
    expect(await attemptsFor(key)).toBe(3);
    // Two recent ones now (this + the 1-minute-old one), then a third is too many.
    expect((await consumeAttempt([limit(key, 2, 15 * MINUTE)])).limited).toBe(false);
    expect((await consumeAttempt([limit(key, 2, 15 * MINUTE)])).limited).toBe(true);
  });

  it("isolates keys from each other", async () => {
    const busy = freshKey("busy");
    const quiet = freshKey("quiet");
    await seedAttempts(busy, 3);
    expect((await consumeAttempt([limit(busy)])).limited).toBe(true);
    expect((await consumeAttempt([limit(quiet)])).limited).toBe(false);
    // Keys are exact matches, not prefixes.
    expect((await consumeAttempt([limit(`${busy}:x`)])).limited).toBe(false);
    expect((await consumeAttempt([limit(busy.slice(0, -1))])).limited).toBe(false);
  });

  it("is limited when any one of several limits is exceeded, and then counts against none of them", async () => {
    const account = freshKey("login:account");
    const ip = freshKey("login:ip");
    await seedAttempts(ip, 5);
    expect((await consumeAttempt([limit(account, 3), limit(ip, 10)])).limited).toBe(false);
    expect(await attemptsFor(account)).toBe(1);
    expect(await attemptsFor(ip)).toBe(6);

    // The ip limit is exceeded: the attempt isn't recorded under either key.
    expect((await consumeAttempt([limit(account, 3), limit(ip, 6)])).limited).toBe(true);
    expect(await attemptsFor(account)).toBe(1);
    expect(await attemptsFor(ip)).toBe(6);

    // Now the account limit.
    await seedAttempts(account, 2);
    expect((await consumeAttempt([limit(account, 3), limit(ip, 100)])).limited).toBe(true);
    expect(await attemptsFor(account)).toBe(3);
    expect(await attemptsFor(ip)).toBe(6);
  });

  it("release() un-counts just this attempt, under every key", async () => {
    const a = freshKey();
    const b = freshKey();
    await seedAttempts(a, 2);
    const attempt = await consumeAttempt([limit(a, 10), limit(b, 10)]);
    expect(await attemptsFor(a)).toBe(3);
    expect(await attemptsFor(b)).toBe(1);
    await attempt.release();
    expect(await attemptsFor(a)).toBe(2);
    expect(await attemptsFor(b)).toBe(0);
    // Releasing twice is harmless.
    await attempt.release();
    expect(await attemptsFor(a)).toBe(2);
  });

  it("released attempts free up room for later ones", async () => {
    const key = freshKey();
    // Like successful logins: each one is released, so they never add up.
    for (let i = 0; i < 6; i++) {
      const attempt = await consumeAttempt([limit(key, 3)]);
      expect(attempt.limited, `attempt ${i + 1}`).toBe(false);
      await attempt.release();
    }
    expect(await attemptsFor(key)).toBe(0);
  });

  it("parallel attempts can't get more than `max` through", async () => {
    const key = freshKey();
    const results = await Promise.all(Array.from({ length: 30 }, () => consumeAttempt([limit(key, 5)])));
    const allowed = results.filter((r) => !r.limited).length;
    expect(allowed).toBeLessThanOrEqual(5);
    // Only the attempts that went through are left in the table.
    expect(await attemptsFor(key)).toBe(allowed);
  });

  it("parallel attempts within the limit all go through", async () => {
    const key = freshKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeAttempt([limit(key, 5)])));
    expect(results.map((r) => r.limited)).toEqual([false, false, false, false, false]);
    expect(await attemptsFor(key)).toBe(5);
    expect((await consumeAttempt([limit(key, 5)])).limited).toBe(true);
  });

  it("parallel attempts against several limits respect each of them", async () => {
    const shared = freshKey("shared");
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) => consumeAttempt([limit(shared, 8), limit(freshKey(`own${i}`), 1)])),
    );
    const allowed = results.filter((r) => !r.limited).length;
    expect(allowed).toBeLessThanOrEqual(8);
    expect(await attemptsFor(shared)).toBe(allowed);
  });

  it("now and then prunes attempts older than a day, keeping recent ones", async () => {
    const old = freshKey("old");
    const recent = freshKey("recent");
    await insertAttemptsAt(old, [25 * HOUR, 48 * HOUR]);
    await insertAttemptsAt(recent, [23 * HOUR, 1 * MINUTE]);

    // Without the 5% chance hitting, nothing is pruned.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    await consumeAttempt([limit(freshKey())]);
    expect(await attemptsFor(old)).toBe(2);

    vi.spyOn(Math, "random").mockReturnValue(0);
    const trigger = freshKey();
    await consumeAttempt([limit(trigger)]);
    expect(await attemptsFor(old)).toBe(0);
    expect(await attemptsFor(recent)).toBe(2);
    expect(await attemptsFor(trigger)).toBe(1);
  });

  it("records attempts with the database's timestamp at insert time", async () => {
    const db = await getDb();
    const keys = [freshKey(), freshKey()];
    await consumeAttempt(keys.map((key) => limit(key)));
    const rows = await db.select().from(authAttempts).where(inArray(authAttempts.key, keys));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(MINUTE);
    }
  });
});

describe("clearAttempts", () => {
  it("forgets the given keys only", async () => {
    const cleared = freshKey();
    const kept = freshKey();
    await seedAttempts(cleared, 3);
    await seedAttempts(kept, 3);
    await clearAttempts([cleared]);
    expect(await attemptsFor(cleared)).toBe(0);
    expect(await attemptsFor(kept)).toBe(3);
    expect((await consumeAttempt([limit(cleared, 3, HOUR)])).limited).toBe(false);
    expect((await consumeAttempt([limit(kept, 3, HOUR)])).limited).toBe(true);
  });

  it("clears several keys at once; unknown keys and an empty list are a no-op", async () => {
    const a = freshKey();
    const b = freshKey();
    await consumeAttempt([limit(a), limit(b)]);
    await clearAttempts([a, b, freshKey()]);
    expect(await attemptsFor(a)).toBe(0);
    expect(await attemptsFor(b)).toBe(0);
    await expect(clearAttempts([])).resolves.toBeUndefined();
  });
});

describe("AUTH_RATE_LIMIT=off", () => {
  it("never reports a limit and doesn't record attempts", async () => {
    const key = freshKey();
    await seedAttempts(key, 3);
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    const attempt = await consumeAttempt([limit(key, 3, HOUR)]);
    expect(attempt.limited).toBe(false);
    await attempt.release();
    expect(await attemptsFor(key)).toBe(3);

    // Back on: the attempts recorded before are still counted.
    vi.unstubAllEnvs();
    expect((await consumeAttempt([limit(key, 3, HOUR)])).limited).toBe(true);
  });

  it('only exactly "off" disables it', async () => {
    const key = freshKey();
    await seedAttempts(key, 1);
    for (const value of ["", "0", "false", "OFF", "no"]) {
      vi.stubEnv("AUTH_RATE_LIMIT", value);
      expect((await consumeAttempt([limit(key, 1, HOUR)])).limited, `AUTH_RATE_LIMIT=${value}`).toBe(true);
    }
  });

  it("still lets attempts be cleared", async () => {
    const key = freshKey();
    await seedAttempts(key, 2);
    vi.stubEnv("AUTH_RATE_LIMIT", "off");
    await clearAttempts([key]);
    expect(await attemptsFor(key)).toBe(0);
  });
});
