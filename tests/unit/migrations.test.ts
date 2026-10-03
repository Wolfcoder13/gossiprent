/**
 * The SQL migrations in ./drizzle build exactly the schema the app's Drizzle
 * tables describe, with the database-level rules the app relies on.
 *
 * Runs on an in-memory embedded Postgres (PGlite), so it needs no setup.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authAttempts, properties, reviews, sessions, users } from "@/db/schema";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** The Postgres error code a query fails with, or undefined if it succeeds. */
async function errorCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("a brand-new database", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("has exactly the columns the app's tables declare", async () => {
    for (const table of [users, sessions, properties, reviews, authAttempts]) {
      const columns = Object.values(getTableColumns(table)).map((column) => column.name);
      const name = getTableName(table);
      const { rows } = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
        [name],
      );
      expect(rows.map((row) => row.column_name).sort(), name).toEqual([...columns].sort());
    }
  });

  it("has no leftovers from the single-role design", async () => {
    const { rows } = await client.query("select 1 from pg_type where typname = 'user_role'");
    expect(rows).toEqual([]);
  });

  it("refuses an account with neither role", async () => {
    expect(
      await errorCode(
        client.query("insert into users (name, email, password_hash) values ('No Role', 'none@example.com', 'x')"),
      ),
    ).toBe("23514");
  });

  it("allows one review per author, person, and role", async () => {
    const {
      rows: [both],
    } = await client.query<{ id: string }>(
      "insert into users (name, email, password_hash, is_landlord, is_renter) values ('Both', 'both@example.com', 'x', true, true) returning id",
    );
    const {
      rows: [author],
    } = await client.query<{ id: string }>(
      "insert into users (name, email, password_hash, is_landlord, is_renter) values ('Author', 'author@example.com', 'x', true, true) returning id",
    );
    const review = (kind: string) =>
      client.query(
        "insert into reviews (kind, author_id, subject_user_id, rating, title, body) values ($1, $2, $3, 4, 'Title', 'A long enough review body')",
        [kind, author.id, both.id],
      );
    await review("landlord");
    await review("renter");
    expect(await errorCode(review("landlord"))).toBe("23505");
  });

  it("running the migrations again changes nothing", async () => {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(rows).toEqual([{ n: 1 }]);
  });
});
