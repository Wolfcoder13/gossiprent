import { afterEach, describe, expect, it, vi } from "vitest";
// "@/db" imports "server-only" (stubbed in vitest.config.ts); nothing here opens a connection.
import { DatabaseNotConfiguredError, getDatabaseMode, pgErrorCode } from "@/db";
import { connect, getDatabaseUrl } from "@/db/connect";

describe("pgErrorCode", () => {
  it("reads the Postgres error code from the error itself", () => {
    expect(pgErrorCode(Object.assign(new Error("dup"), { code: "23505" }))).toBe("23505");
  });

  it("finds the code on a wrapped driver error (drizzle puts it on `cause`)", () => {
    const driverError = Object.assign(new Error("duplicate key"), { code: "23505" });
    const wrapped = new Error("Failed query: insert into users …", { cause: driverError });
    expect(pgErrorCode(wrapped)).toBe("23505");
    const doublyWrapped = new Error("outer", { cause: wrapped });
    expect(pgErrorCode(doublyWrapped)).toBe("23505");
  });

  it("returns undefined when there is no string code", () => {
    expect(pgErrorCode(new Error("plain"))).toBeUndefined();
    expect(pgErrorCode(Object.assign(new Error("numeric"), { code: 23505 }))).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode("23505")).toBeUndefined();
  });

  it("stops after a few levels of nesting (and on cycles)", () => {
    let error: Error = Object.assign(new Error("deep"), { code: "23505" });
    for (let i = 0; i < 10; i++) error = new Error(`wrap ${i}`, { cause: error });
    expect(pgErrorCode(error)).toBeUndefined();

    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(pgErrorCode(cyclic)).toBeUndefined();
  });
});

describe("database mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function setEnv(env: { DATABASE_URL?: string; POSTGRES_URL?: string; VERCEL?: string }) {
    vi.stubEnv("DATABASE_URL", env.DATABASE_URL ?? "");
    vi.stubEnv("POSTGRES_URL", env.POSTGRES_URL ?? "");
    vi.stubEnv("VERCEL", env.VERCEL ?? "");
  }

  it("uses Postgres when DATABASE_URL is set", () => {
    setEnv({ DATABASE_URL: "postgres://a@b/c" });
    expect(getDatabaseMode()).toBe("postgres");
    expect(getDatabaseUrl()).toBe("postgres://a@b/c");
  });

  it("falls back to POSTGRES_URL", () => {
    setEnv({ POSTGRES_URL: "postgres://x@y/z", VERCEL: "1" });
    expect(getDatabaseMode()).toBe("postgres");
    expect(getDatabaseUrl()).toBe("postgres://x@y/z");
  });

  it("prefers DATABASE_URL over POSTGRES_URL", () => {
    setEnv({ DATABASE_URL: "postgres://first", POSTGRES_URL: "postgres://second" });
    expect(getDatabaseUrl()).toBe("postgres://first");
  });

  it("uses the embedded database locally without a URL", () => {
    setEnv({});
    expect(getDatabaseMode()).toBe("pglite");
    expect(getDatabaseUrl()).toBeUndefined();
  });

  it("is unconfigured on Vercel without a URL, and connecting fails with a helpful error", async () => {
    setEnv({ VERCEL: "1" });
    expect(getDatabaseMode()).toBe("unconfigured");
    await expect(connect()).rejects.toBeInstanceOf(DatabaseNotConfiguredError);
    await expect(connect()).rejects.toThrow(/Set DATABASE_URL/);
  });
});
