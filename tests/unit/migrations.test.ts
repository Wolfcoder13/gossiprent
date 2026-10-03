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
import { authAttempts, properties, reports, reviews, sessions, users } from "@/db/schema";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

// ON DELETE RESTRICT: 23503 up to Postgres 17, 23001 from Postgres 18 (and PGlite).
const STILL_REFERENCED = expect.stringMatching(/^(23503|23001)$/);

/** The Postgres error a query fails with (code and constraint), or undefined if it succeeds. */
async function failure(query: Promise<unknown>): Promise<{ code?: string; constraint?: string } | undefined> {
  try {
    await query;
    return undefined;
  } catch (error) {
    const { code, constraint } = error as { code?: string; constraint?: string };
    return { code, constraint };
  }
}

describe("a brand-new database", () => {
  let client: PGlite;
  let counter = 0;

  /** A kennitala-shaped value no other row in this file uses. */
  const nextKennitala = () => `01013${String(++counter).padStart(5, "0")}`;

  type UserValues = {
    kennitala?: string;
    landlord?: boolean;
    renter?: boolean;
    email?: string | null;
    passwordHash?: string | null;
    joinedAt?: Date | null;
    city?: string | null;
  };

  function insertUser(values: UserValues = {}) {
    const email = values.email === undefined ? `user${++counter}@example.com` : values.email;
    return client.query<{ id: string }>(
      `insert into users (kennitala, name, name_sort, name_search, email, password_hash, joined_at,
         is_landlord, is_renter, city)
       values ($1, 'Name', 'name', 'name', $2, $3, $4, $5, $6, $7) returning id`,
      [
        values.kennitala ?? nextKennitala(),
        email,
        values.passwordHash === undefined ? (email === null ? null : "hash") : values.passwordHash,
        values.joinedAt === undefined ? (email === null ? null : new Date()) : values.joinedAt,
        values.landlord ?? true,
        values.renter ?? false,
        values.city ?? null,
      ],
    );
  }

  async function userId(values: UserValues = {}): Promise<string> {
    return (await insertUser(values)).rows[0].id;
  }

  function insertProperty(addressSearch: string, postalCode: number, landlordId: string | null = null) {
    return client.query<{ id: string }>(
      `insert into properties (address, postal_code, address_sort, address_search, landlord_id)
       values ('Address', $1, 'sort', $2, $3) returning id`,
      [postalCode, addressSearch, landlordId],
    );
  }

  function insertReview(kind: string, authorId: string, subjectId: string) {
    return client.query<{ id: string }>(
      `insert into reviews (kind, author_id, subject_user_id, property_id, rating, title, body)
       values ($1, $2, $3, $4, 4, 'Title', 'A long enough review body') returning id`,
      kind === "property" ? [kind, authorId, null, subjectId] : [kind, authorId, subjectId, null],
    );
  }

  beforeAll(async () => {
    client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it("has exactly the columns the app's tables declare", async () => {
    for (const table of [users, sessions, properties, reviews, authAttempts, reports]) {
      const columns = Object.values(getTableColumns(table)).map((column) => column.name);
      const name = getTableName(table);
      const { rows } = await client.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
        [name],
      );
      expect(rows.map((row) => row.column_name).sort(), name).toEqual([...columns].sort());
    }
  });

  it("refuses a person with neither role", async () => {
    expect(await failure(insertUser({ landlord: false, renter: false }))).toEqual({
      code: "23514",
      constraint: "users_has_a_role",
    });
  });

  it("stores a kennitala as exactly 10 digits", async () => {
    for (const kennitala of ["010130212", "01013021x9", "010130-212"]) {
      expect(await failure(insertUser({ kennitala })), kennitala).toEqual({
        code: "23514",
        constraint: "users_kennitala_digits",
      });
    }
    expect(await failure(insertUser({ kennitala: "0101302129" }))).toBeUndefined();
  });

  it("gives each kennitala one row", async () => {
    const kennitala = nextKennitala();
    await insertUser({ kennitala });
    expect(await failure(insertUser({ kennitala, email: null }))).toEqual({
      code: "23505",
      constraint: "users_kennitala_unique",
    });
  });

  it("has all of email, password hash and joined date (an account), or none of them", async () => {
    expect(await failure(insertUser({ email: null }))).toBeUndefined();
    expect(await failure(insertUser({}))).toBeUndefined();
    for (const partial of [
      { email: "partial1@example.com", passwordHash: null },
      { email: "partial2@example.com", joinedAt: null },
      { email: null, passwordHash: "hash" },
      { email: null, joinedAt: new Date() },
    ]) {
      expect(await failure(insertUser(partial)), JSON.stringify(partial)).toEqual({
        code: "23514",
        constraint: "users_account_complete",
      });
    }
  });

  it("lets many profiles without an account exist, but gives each email one account", async () => {
    await insertUser({ email: null });
    await insertUser({ email: null });
    await insertUser({ email: "taken@example.com" });
    expect(await failure(insertUser({ email: "taken@example.com" }))).toEqual({
      code: "23505",
      constraint: "users_email_unique",
    });
  });

  it("only lets accounts have a city or bio", async () => {
    expect(await failure(insertUser({ email: null, city: "Reykjavík" }))).toEqual({
      code: "23514",
      constraint: "users_profile_text_needs_account",
    });
    const id = await userId({ email: null });
    expect(await failure(client.query("update users set bio = 'Hæ' where id = $1", [id]))).toEqual({
      code: "23514",
      constraint: "users_profile_text_needs_account",
    });
    expect(await failure(insertUser({ city: "Reykjavík" }))).toBeUndefined();
  });

  it("has one property per folded address and postcode", async () => {
    await insertProperty("njalsgata 23 0201", 101);
    expect(await failure(insertProperty("njalsgata 23 0201", 101))).toEqual({
      code: "23505",
      constraint: "properties_address_unique",
    });
    // The same street address in another postcode, or another apartment, is another property.
    expect(await failure(insertProperty("njalsgata 23 0201", 107))).toBeUndefined();
    expect(await failure(insertProperty("njalsgata 23 0202", 101))).toBeUndefined();
  });

  it("only takes Icelandic-range postcodes", async () => {
    for (const postalCode of [99, 1000]) {
      expect(await failure(insertProperty(`range ${postalCode}`, postalCode))).toEqual({
        code: "23514",
        constraint: "properties_postal_code_range",
      });
    }
  });

  it("never deletes reviews about someone by deleting the person or the property", async () => {
    const author = await userId({ renter: true });
    const subject = await userId();
    const reviewed = await insertReview("landlord", author, subject);
    expect(await failure(client.query("delete from users where id = $1", [subject]))).toEqual({
      code: STILL_REFERENCED,
      constraint: "reviews_subject_user_id_users_id_fk",
    });

    const property = (await insertProperty(`reviewed ${counter}`, 101)).rows[0].id;
    await insertReview("property", author, property);
    expect(await failure(client.query("delete from properties where id = $1", [property]))).toEqual({
      code: STILL_REFERENCED,
      constraint: "reviews_property_id_properties_id_fk",
    });

    // Closing the author's account does take the reviews they wrote.
    await client.query("delete from users where id = $1", [author]);
    const { rows } = await client.query("select id from reviews where id = $1", [reviewed.rows[0].id]);
    expect(rows).toEqual([]);
  });

  it("keeps a property's landlord until the link is removed, and forgets a deleted creator", async () => {
    const landlord = await userId({ email: null });
    const creator = await userId({ renter: true });
    const property = (await insertProperty(`linked ${counter}`, 101, landlord)).rows[0].id;
    await client.query("update properties set created_by_id = $1 where id = $2", [creator, property]);

    expect(await failure(client.query("delete from users where id = $1", [landlord]))).toEqual({
      code: STILL_REFERENCED,
      constraint: "properties_landlord_id_users_id_fk",
    });
    await client.query("delete from users where id = $1", [creator]);
    const { rows } = await client.query("select created_by_id from properties where id = $1", [property]);
    expect(rows).toEqual([{ created_by_id: null }]);
  });

  it("allows one review per author, person, and role", async () => {
    const both = await userId({ renter: true });
    const author = await userId({ renter: true });
    await insertReview("landlord", author, both);
    await insertReview("renter", author, both);
    expect(await failure(insertReview("landlord", author, both))).toEqual({
      code: "23505",
      constraint: "reviews_author_subject_user_kind_unique",
    });
  });

  it("running the migrations again changes nothing", async () => {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations");
    expect(rows).toEqual([{ n: 1 }]);
  });
});
