/**
 * The upgrade path for databases created before accounts could have both
 * roles: apply migrations 0000–0001, add accounts with the old single `role`
 * column, then apply the rest and check every account kept its role as the
 * new is_landlord / is_renter flags (and nothing else was lost).
 *
 * The upgrade is expand/contract: the old `role` column (and its `user_role`
 * enum) stays, nullable and unused by the new code, so the previous
 * deployment, still serving while the new one builds, keeps working against
 * the migrated database. The "old code" tests below run the old app's queries
 * (written with the old Drizzle table definition) against the new schema.
 *
 * Runs on an in-memory embedded Postgres (PGlite), so it needs no setup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@/db/schema";

/**
 * The `users` table as the previous release of the app defined it (single
 * NOT NULL role, no flags), to run that release's queries against the
 * upgraded database.
 */
const oldUserRole = pgEnum("user_role", ["landlord", "renter"]);
const oldUsers = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: oldUserRole("role").notNull(),
  city: text("city"),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const BEFORE_DUAL_ROLES = ["0000_init", "0001_soft_delete_and_rate_limits"];

type Journal = { entries: { tag: string }[] } & Record<string, unknown>;

/** A copy of ./drizzle containing only the given migrations. */
function migrationsFolderWith(tags: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gossiprent-unit-migrations-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as Journal;
  const entries = journal.entries.filter((entry) => tags.includes(entry.tag));
  expect(entries.map((entry) => entry.tag)).toEqual(tags);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const tag of tags) fs.copyFileSync(path.join(MIGRATIONS, `${tag}.sql`), path.join(dir, `${tag}.sql`));
  return dir;
}

/** Postgres error code of a failed query (PGlite puts it on the error itself). */
async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    let current: unknown = error;
    for (let i = 0; i < 5 && current && typeof current === "object"; i++) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string") return code;
      current = (current as { cause?: unknown }).cause;
    }
    throw error;
  }
  return undefined;
}

const ids = {
  landlord: "00000000-0000-4000-8000-000000000001",
  renter: "00000000-0000-4000-8000-000000000002",
  closedRenter: "00000000-0000-4000-8000-000000000003",
  property: "00000000-0000-4000-8000-0000000000a1",
};

describe("upgrading a database from single roles to dual roles", () => {
  let client: PGlite;
  let oldFolder: string;

  beforeAll(async () => {
    client = new PGlite();
    const db = drizzle(client);
    oldFolder = migrationsFolderWith(BEFORE_DUAL_ROLES);
    await migrate(db, { migrationsFolder: oldFolder });

    // Data written by the old version of the app.
    await client.exec(`
      insert into users (id, name, email, password_hash, role, city) values
        ('${ids.landlord}', 'Old Landlord', 'old-landlord@example.com', 'hash', 'landlord', 'Austin'),
        ('${ids.renter}', 'Old Renter', 'old-renter@example.com', 'hash', 'renter', 'Austin');
      insert into users (id, name, email, password_hash, role, deleted_at) values
        ('${ids.closedRenter}', 'Closed Renter', 'deleted-x@deleted.invalid', 'deleted', 'renter', now());
      insert into properties (id, address, city, region, landlord_id, created_by_id) values
        ('${ids.property}', '1 Upgrade St', 'Austin', 'TX', '${ids.landlord}', '${ids.renter}');
      insert into reviews (kind, author_id, subject_user_id, rating, title, body) values
        ('landlord', '${ids.renter}', '${ids.landlord}', 5, 'Great', 'A great landlord, fixed things fast.'),
        ('renter', '${ids.landlord}', '${ids.renter}', 4, 'Good', 'A good renter, always paid on time.'),
        ('renter', '${ids.landlord}', '${ids.closedRenter}', 2, 'Meh', 'Left the place in a bit of a state.');
      insert into reviews (kind, author_id, property_id, rating, title, body) values
        ('property', '${ids.renter}', '${ids.property}', 3, 'Okay', 'Decent apartment, thin walls though.');
    `);

    // Now upgrade to the current schema.
    await migrate(db, { migrationsFolder: MIGRATIONS });
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (oldFolder) fs.rmSync(oldFolder, { recursive: true, force: true });
  });

  it("every existing account keeps its role as the matching flag", async () => {
    const { rows } = await client.query<{ id: string; is_landlord: boolean; is_renter: boolean }>(
      "select id, is_landlord, is_renter from users order by id",
    );
    expect(rows).toEqual([
      { id: ids.landlord, is_landlord: true, is_renter: false },
      { id: ids.renter, is_landlord: false, is_renter: true },
      { id: ids.closedRenter, is_landlord: false, is_renter: true },
    ]);
  });

  it("keeps the old role column (now nullable) and its enum type, for the previous deployment", async () => {
    const columns = await client.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'users' order by column_name",
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      "bio",
      "city",
      "created_at",
      "deleted_at",
      "email",
      "id",
      "is_landlord",
      "is_renter",
      "name",
      "password_hash",
      "role",
    ]);
    const role = await client.query<{ udt_name: string; is_nullable: string; column_default: string | null }>(
      `select udt_name, is_nullable, column_default from information_schema.columns
       where table_name = 'users' and column_name = 'role'`,
    );
    expect(role.rows).toEqual([{ udt_name: "user_role", is_nullable: "YES", column_default: null }]);
    const labels = await client.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'user_role' order by e.enumsortorder`,
    );
    expect(labels.rows.map((r) => r.enumlabel)).toEqual(["landlord", "renter"]);
    // Existing accounts still carry the role they had.
    const { rows } = await client.query<{ id: string; role: string | null }>(
      "select id, role::text as role from users order by id",
    );
    expect(rows).toEqual([
      { id: ids.landlord, role: "landlord" },
      { id: ids.renter, role: "renter" },
      { id: ids.closedRenter, role: "renter" },
    ]);
  });

  it("keeps every review, property, and link", async () => {
    const reviews = await client.query<{ kind: string; rating: number }>(
      "select kind::text as kind, rating from reviews order by kind::text, rating",
    );
    expect(reviews.rows).toEqual([
      { kind: "landlord", rating: 5 },
      { kind: "property", rating: 3 },
      { kind: "renter", rating: 2 },
      { kind: "renter", rating: 4 },
    ]);
    const property = await client.query("select landlord_id, created_by_id from properties");
    expect(property.rows).toEqual([{ landlord_id: ids.landlord, created_by_id: ids.renter }]);
  });

  it("swaps the per-person unique index for a per-person-per-role one", async () => {
    const { rows } = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where tablename in ('users', 'reviews') order by indexname",
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain("reviews_author_subject_user_kind_unique");
    expect(names).toContain("users_is_landlord_idx");
    expect(names).toContain("users_is_renter_idx");
    expect(names).not.toContain("reviews_author_subject_user_unique");
    expect(names).not.toContain("users_role_idx");
  });

  it("an upgraded landlord can add the renter role and be reviewed in it by the same person", async () => {
    await client.query("update users set is_renter = true where id = $1", [ids.landlord]);
    await client.query("update users set is_landlord = true where id = $1", [ids.renter]);
    // The old renter already reviewed them as a landlord; now also as a renter.
    await client.query(
      `insert into reviews (kind, author_id, subject_user_id, rating, title, body)
       values ('renter', $1, $2, 4, 'Also fine', 'Rented my spare room for a summer.')`,
      [ids.renter, ids.landlord],
    );
    // But still only once per role.
    expect(
      await errorCode(
        client.query(
          `insert into reviews (kind, author_id, subject_user_id, rating, title, body)
           values ('landlord', $1, $2, 1, 'Again', 'A second review of the same landlord.')`,
          [ids.renter, ids.landlord],
        ),
      ),
    ).toBe("23505");
  });

  it("refuses an account with neither role", async () => {
    // During the transition the sync trigger restores the flag from the legacy
    // role instead, so clearing both flags can't leave an account roleless.
    await client.query("update users set is_renter = false where id = $1", [ids.closedRenter]);
    const { rows } = await client.query<{ is_renter: boolean }>("select is_renter from users where id = $1", [
      ids.closedRenter,
    ]);
    expect(rows).toEqual([{ is_renter: true }]);
    expect(
      await errorCode(
        client.query("insert into users (name, email, password_hash) values ('No Role', 'none@example.com', 'x')"),
      ),
    ).toBe("23514");
  });

  it("matches the schema the app uses", async () => {
    const db = drizzle(client, { schema: { users } });
    const rows = await db.select().from(users);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "bio",
        "city",
        "createdAt",
        "deletedAt",
        "email",
        "id",
        "isLandlord",
        "isRenter",
        "legacyRole",
        "name",
        "passwordHash",
      ].sort(),
    );
  });

  it("the new code can add accounts without the old role column", async () => {
    const db = drizzle(client, { schema: { users } });
    const [row] = await db
      .insert(users)
      .values({ name: "New Both", email: "new-both@example.com", passwordHash: "x", isLandlord: true, isRenter: true })
      .returning();
    // The sync trigger fills in the legacy role so the previous release can still read the account.
    expect(row).toMatchObject({ isLandlord: true, isRenter: true, legacyRole: "landlord" });
    await db.delete(users).where(eq(users.id, row.id));
  });

  describe("the previous release's queries still work during the deploy", () => {
    it("reads accounts and their role, and finds them by role", async () => {
      const db = drizzle(client);
      const [landlord] = await db.select().from(oldUsers).where(eq(oldUsers.id, ids.landlord));
      expect(landlord).toMatchObject({ id: ids.landlord, role: "landlord", name: "Old Landlord" });
      // The old landlord directory / "who may review whom" checks.
      const landlords = await db
        .select({ id: oldUsers.id })
        .from(oldUsers)
        .where(and(eq(oldUsers.role, "landlord"), eq(oldUsers.id, ids.landlord)));
      expect(landlords).toEqual([{ id: ids.landlord }]);
      const renters = await db.select({ id: oldUsers.id }).from(oldUsers).where(eq(oldUsers.role, "renter"));
      expect(renters.map((r) => r.id).sort()).toEqual(expect.arrayContaining([ids.renter, ids.closedRenter]));
    });

    it("updates a profile and closes an account", async () => {
      const db = drizzle(client);
      await db.update(oldUsers).set({ bio: "Updated by the old code" }).where(eq(oldUsers.id, ids.renter));
      const [row] = await db.select({ bio: oldUsers.bio }).from(oldUsers).where(eq(oldUsers.id, ids.renter));
      expect(row.bio).toBe("Updated by the old code");
      await db.update(oldUsers).set({ bio: null }).where(eq(oldUsers.id, ids.renter));
    });

    // The old code inserts only `role`; the sync trigger sets the matching flag.
    it("signs up a new account (old insert sets only role), which then has the matching flag", async () => {
      const db = drizzle(client);
      const [created] = await db
        .insert(oldUsers)
        .values({ name: "Old Code Signup", email: "old-code-signup@example.com", passwordHash: "x", role: "renter" })
        .returning({ id: oldUsers.id, role: oldUsers.role });
      expect(created.role).toBe("renter");
      // The new code must see the account in the same role once it takes over.
      const { rows } = await client.query<{ is_landlord: boolean; is_renter: boolean }>(
        "select is_landlord, is_renter from users where id = $1",
        [created.id],
      );
      expect(rows).toEqual([{ is_landlord: false, is_renter: true }]);
      await client.query("delete from users where id = $1", [created.id]);
    });

    it("writes and edits reviews", async () => {
      const db = drizzle(client);
      const [author] = await db.select({ id: oldUsers.id }).from(oldUsers).where(eq(oldUsers.id, ids.landlord));
      // The old saveReview: update the author's review of that person, else insert.
      const updated = await client.query(
        `update reviews set title = 'Good (edited)' where author_id = $1 and subject_user_id = $2 returning id`,
        [author.id, ids.renter],
      );
      expect(updated.rows).toHaveLength(1);
      // A second review of the same person in the same role is still refused.
      expect(
        await errorCode(
          client.query(
            `insert into reviews (kind, author_id, subject_user_id, rating, title, body)
             values ('renter', $1, $2, 1, 'Dupe', 'A duplicate review of the same renter.')`,
            [author.id, ids.renter],
          ),
        ),
      ).toBe("23505");
      await client.query(`update reviews set title = 'Good' where id = $1`, [(updated.rows[0] as { id: string }).id]);
    });
  });

  it("running the migrations again changes nothing", async () => {
    const before = await client.query("select id, is_landlord, is_renter from users order by id");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    expect((await client.query("select id, is_landlord, is_renter from users order by id")).rows).toEqual(before.rows);
  });
});

describe("a brand-new database", () => {
  it("migrates from scratch to the same columns", async () => {
    const client = new PGlite();
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
      const { rows } = await client.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
        `select column_name, column_default, is_nullable from information_schema.columns
         where table_name = 'users' and column_name in ('is_landlord', 'is_renter') order by column_name`,
      );
      expect(rows).toEqual([
        { column_name: "is_landlord", column_default: "false", is_nullable: "NO" },
        { column_name: "is_renter", column_default: "false", is_nullable: "NO" },
      ]);
      // The legacy column exists here too, optional, so the app's inserts
      // (which never set it) work on a brand-new database.
      const legacy = await client.query<{ is_nullable: string }>(
        "select is_nullable from information_schema.columns where table_name = 'users' and column_name = 'role'",
      );
      expect(legacy.rows).toEqual([{ is_nullable: "YES" }]);
      const db = drizzle(client, { schema: { users } });
      const [row] = await db
        .insert(users)
        .values({ name: "Fresh", email: "fresh@example.com", passwordHash: "x", isRenter: true })
        .returning();
      expect(row).toMatchObject({ isLandlord: false, isRenter: true, legacyRole: "renter" });
    } finally {
      await client.close();
    }
  }, 60_000);
});
