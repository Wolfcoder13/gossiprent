import { afterEach, describe, expect, it, vi } from "vitest";
// "@/db" imports "server-only" (stubbed in vitest.config.mts); nothing here opens a connection.
import { getDatabaseMode, pgConstraint, pgErrorCode, sanitizeDbError } from "@/db";
import { connect, DatabaseNotConfiguredError, getDatabaseUrl } from "@/db/connect";

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

describe("pgConstraint", () => {
  it("reads the constraint name from the error or a wrapped driver error", () => {
    const driverError = Object.assign(new Error("duplicate key"), { code: "23505", constraint: "users_email_unique" });
    expect(pgConstraint(driverError)).toBe("users_email_unique");
    expect(pgConstraint(new Error("Failed query", { cause: driverError }))).toBe("users_email_unique");
  });

  it("returns undefined when there is none", () => {
    expect(pgConstraint(new Error("plain"))).toBeUndefined();
    expect(pgConstraint(Object.assign(new Error("x"), { code: "25P02" }))).toBeUndefined();
    expect(pgConstraint(undefined)).toBeUndefined();
  });
});

describe("sanitizeDbError", () => {
  // What drizzle throws: the query and its parameters in the message, Postgres's
  // error (with the row values in its detail) as the cause.
  const kennitala = "1503853579";
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "users_kennitala_unique",
    detail: `Key (kennitala)=(${kennitala}) already exists.`,
  });
  const drizzleError = new Error(
    `Failed query: insert into "users" ("kennitala", "email") values ($1, $2)\nparams: ${kennitala},jon@example.com`,
    { cause: driverError },
  );

  it("keeps only the Postgres code and constraint name", () => {
    const sanitized = sanitizeDbError(drizzleError);
    expect(sanitized.message).toBe("Database error 23505 (users_kennitala_unique)");
    expect(sanitized.cause).toBeUndefined();
    expect(`${sanitized.message}\n${sanitized.stack}`).not.toContain(kennitala);
    expect(`${sanitized.message}\n${sanitized.stack}`).not.toContain("jon@example.com");
  });

  it("copes with errors that have no code or constraint", () => {
    expect(sanitizeDbError(Object.assign(new Error("x"), { code: "25P02" })).message).toBe("Database error 25P02");
    expect(sanitizeDbError(new Error(`connection lost while sending ${kennitala}`)).message).toBe(
      "Database error unknown",
    );
    expect(sanitizeDbError("not an error").message).toBe("Database error unknown");
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
