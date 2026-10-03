/**
 * src/lib/people.ts against a real database: finding and creating people by
 * kennitala, granting roles (the subject lock), name locks, and tidying up
 * profiles without an account. The races at the end only really race on a
 * real Postgres (UNIT_DATABASE_URL; see support/harness.ts).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/db";
import { properties, reviews, users } from "@/db/schema";
import {
  ensurePerson,
  findPersonByKennitala,
  getOwnKennitala,
  grantRoleById,
  grantRoleByKennitala,
  isNameLocked,
  isStillReferenced,
  nameLockedSql,
  personNameKeys,
  propertyAddressKeys,
  reconcileProfiles,
} from "@/lib/people";
import { icelandicSortKey } from "@/lib/text";
import {
  atOnce,
  createUser,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  unique,
  userRow,
  usingPostgres,
} from "./support/harness";

/** Run `body` in a transaction that is always rolled back. */
async function inRolledBackTransaction(body: (tx: Transaction) => Promise<void>): Promise<void> {
  const db = await getDb();
  const rollback = new Error("roll back");
  await expect(
    db.transaction(async (tx) => {
      await body(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

/** Run `body` in a transaction and commit it. */
async function inTransaction<T>(body: (tx: Transaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(body);
}

async function rowsWithKennitala(kennitala: string): Promise<{ id: string }[]> {
  const db = await getDb();
  return db.select({ id: users.id }).from(users).where(eq(users.kennitala, kennitala));
}

/** A promise plus the function that resolves it, to hold a transaction open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("findPersonByKennitala", () => {
  it("finds accounts and profiles without one, without ever returning the kennitala or email", async () => {
    const account = await createUser({ roles: "both" });
    const profile = await createUser({ roles: "landlord", account: false, company: true });

    const foundAccount = await findPersonByKennitala(account.kennitala);
    expect(foundAccount).toEqual({
      id: account.id,
      name: account.name,
      isLandlord: true,
      isRenter: true,
      isCompany: false,
      hasAccount: true,
    });
    expect(await findPersonByKennitala(profile.kennitala)).toEqual({
      id: profile.id,
      name: profile.name,
      isLandlord: true,
      isRenter: false,
      isCompany: true,
      hasAccount: false,
    });
  });

  it("is null for a kennitala nobody has", async () => {
    expect(await findPersonByKennitala(freshKennitala())).toBeNull();
  });

  it("can read inside a transaction", async () => {
    const person = await createUser({ roles: "renter", account: false });
    await inRolledBackTransaction(async (tx) => {
      expect((await findPersonByKennitala(person.kennitala, tx))?.id).toBe(person.id);
    });
  });
});

describe("ensurePerson", () => {
  it("creates a profile without an account, named as typed, with the role it was reviewed in", async () => {
    const kennitala = freshKennitala();
    const result = await inTransaction((tx) =>
      ensurePerson(tx, { kennitala, name: "  Þórdís   Jónsdóttir ", isCompany: false, role: "renter" }),
    );
    expect(result.created).toBe(true);
    expect(await userRow(result.id)).toMatchObject({
      kennitala,
      name: "Þórdís Jónsdóttir",
      nameSort: icelandicSortKey("Þórdís Jónsdóttir"),
      nameSearch: "thordis jonsdottir",
      isCompany: false,
      isLandlord: false,
      isRenter: true,
      email: null,
      passwordHash: null,
      joinedAt: null,
      city: null,
      bio: null,
    });
  });

  it("stores a company as one", async () => {
    const kennitala = freshKennitala("company");
    const { id } = await inTransaction((tx) =>
      ensurePerson(tx, { kennitala, name: "Prófun leigufélag ehf.", isCompany: true, role: "landlord" }),
    );
    expect(await userRow(id)).toMatchObject({ isCompany: true, isLandlord: true, isRenter: false });
  });

  it("for a known kennitala, adds the role and keeps the name the first reviewer typed", async () => {
    const profile = await createUser({ roles: "renter", account: false, name: "Jón Jónsson" });
    const result = await inTransaction((tx) =>
      ensurePerson(tx, { kennitala: profile.kennitala, name: "Jon Jonsson", isCompany: false, role: "landlord" }),
    );
    expect(result).toEqual({ id: profile.id, created: false });
    expect(await userRow(profile.id)).toMatchObject({ name: "Jón Jónsson", isLandlord: true, isRenter: true });
  });

  it("for an account, only adds the role", async () => {
    const account = await createUser({ roles: "landlord" });
    const result = await inTransaction((tx) =>
      ensurePerson(tx, { kennitala: account.kennitala, name: "Someone Else", isCompany: false, role: "renter" }),
    );
    expect(result).toEqual({ id: account.id, created: false });
    expect(await userRow(account.id)).toMatchObject({
      name: account.name,
      email: account.email,
      isLandlord: true,
      isRenter: true,
    });
  });

  it("writes nothing if the transaction is rolled back", async () => {
    const kennitala = freshKennitala();
    await inRolledBackTransaction(async (tx) => {
      await ensurePerson(tx, { kennitala, name: "Rolled Back", isCompany: false, role: "landlord" });
    });
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
  });
});

describe("grantRoleByKennitala", () => {
  it("gives the person the role and returns them", async () => {
    const renter = await createUser({ roles: "renter" });
    const person = await inTransaction((tx) => grantRoleByKennitala(tx, renter.kennitala, "landlord"));
    expect(person).toEqual({
      id: renter.id,
      name: renter.name,
      isLandlord: true,
      isRenter: true,
      isCompany: false,
      hasAccount: true,
    });
    expect(await userRow(renter.id)).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("is null for an unknown kennitala, and creates nobody", async () => {
    const kennitala = freshKennitala();
    expect(await inTransaction((tx) => grantRoleByKennitala(tx, kennitala, "renter"))).toBeNull();
    expect(await rowsWithKennitala(kennitala)).toEqual([]);
  });
});

describe("grantRoleById", () => {
  it("gives the role when the kennitala is this profile's", async () => {
    const profile = await createUser({ roles: "landlord", account: false });
    expect(await inTransaction((tx) => grantRoleById(tx, profile.id, profile.kennitala, "renter"))).toBe(true);
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true, isRenter: true });
  });

  it("is false, and changes nobody, when the kennitala is someone else's or nobody's", async () => {
    const profile = await createUser({ roles: "landlord", account: false });
    const other = await createUser({ roles: "landlord" });
    for (const kennitala of [other.kennitala, freshKennitala()]) {
      expect(await inTransaction((tx) => grantRoleById(tx, profile.id, kennitala, "renter"))).toBe(false);
    }
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true, isRenter: false });
    expect(await userRow(other.id)).toMatchObject({ isLandlord: true, isRenter: false });
  });
});

describe("getOwnKennitala", () => {
  it("returns an account's own kennitala, and nothing for profiles without one", async () => {
    const account = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "renter", account: false });
    expect(await getOwnKennitala(account.id)).toBe(account.kennitala);
    expect(await getOwnKennitala(profile.id)).toBeNull();
    expect(await getOwnKennitala("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("isNameLocked", () => {
  it("is false for someone nobody has described", async () => {
    const db = await getDb();
    const person = await createUser({ roles: "both" });
    expect(await isNameLocked(db, person.id)).toBe(false);
    // Properties they added themselves don't count.
    await insertProperty({ landlordId: person.id, createdById: person.id });
    expect(await isNameLocked(db, person.id)).toBe(false);
  });

  it("is true once anyone has reviewed them, in either role", async () => {
    const db = await getDb();
    const author = await createUser({ roles: "both" });
    for (const kind of ["landlord", "renter"] as const) {
      const person = await createUser({ roles: "both" });
      await insertReview({ kind, authorId: author.id, subjectUserId: person.id });
      expect(await isNameLocked(db, person.id), kind).toBe(true);
    }
  });

  it("is true for the landlord of a property someone else added", async () => {
    const db = await getDb();
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    expect(await isNameLocked(db, landlord.id)).toBe(true);
  });

  it("is true when whoever added the property has since left (no creator)", async () => {
    const db = await getDb();
    const landlord = await createUser({ roles: "landlord" });
    await insertProperty({ landlordId: landlord.id, createdById: null });
    expect(await isNameLocked(db, landlord.id)).toBe(true);
  });

  it("works inside a transaction, and is false for an unknown id", async () => {
    const person = await createUser({ roles: "renter" });
    const author = await createUser({ roles: "landlord" });
    await inRolledBackTransaction(async (tx) => {
      expect(await isNameLocked(tx, person.id)).toBe(false);
      await tx.insert(reviews).values({
        kind: "renter",
        authorId: author.id,
        subjectUserId: person.id,
        rating: 4,
        title: "Fine",
        body: "A review body that is long enough.",
      });
      expect(await isNameLocked(tx, person.id)).toBe(true);
      expect(await isNameLocked(tx, "00000000-0000-0000-0000-000000000000")).toBe(false);
    });
  });
});

describe("nameLockedSql", () => {
  /** Signup's single statement: take over a profile without an account, keeping a locked name. */
  async function claim(kennitala: string, typedName: string) {
    const db = await getDb();
    const keys = personNameKeys(typedName);
    const [row] = await db
      .insert(users)
      .values({ kennitala, ...keys, isRenter: true, email: `claim-${unique()}@example.com`, passwordHash: "x", joinedAt: new Date() })
      .onConflictDoUpdate({
        target: users.kennitala,
        set: {
          email: sql`excluded.email`,
          passwordHash: sql`excluded.password_hash`,
          joinedAt: sql`excluded.joined_at`,
          name: sql`case when ${nameLockedSql()} then ${users.name} else excluded.name end`,
        },
        setWhere: isNull(users.email),
      })
      .returning({ name: users.name });
    return row?.name ?? null;
  }

  it("keeps the reviewed name in a signup-style upsert, and takes the typed one otherwise", async () => {
    const author = await createUser({ roles: "landlord" });
    const reviewed = await createUser({ roles: "renter", account: false, name: "Nafn Úr Umsögn" });
    await insertReview({ kind: "renter", authorId: author.id, subjectUserId: reviewed.id });
    expect(await claim(reviewed.kennitala, "Nafn Sem Ég Vel")).toBe("Nafn Úr Umsögn");

    const linkedOnly = await createUser({ roles: "landlord", account: false, name: "Gamalt Nafn" });
    await insertProperty({ landlordId: linkedOnly.id, createdById: author.id });
    expect(await claim(linkedOnly.kennitala, "Nýtt Nafn")).toBe("Gamalt Nafn");

    // Not yet described by anyone else (e.g. a profile whose reviews were all deleted).
    const free = await createUser({ roles: "renter", account: false, name: "Gamalt Nafn" });
    expect(await claim(free.kennitala, "Nýtt Nafn")).toBe("Nýtt Nafn");

    // An account is never taken over.
    const account = await createUser({ roles: "renter" });
    expect(await claim(account.kennitala, "Annað Nafn")).toBeNull();
  });
});

describe("reconcileProfiles", () => {
  it("deletes a profile without an account that nothing refers to any more", async () => {
    const profile = await createUser({ roles: "landlord", account: false });
    await inTransaction((tx) => reconcileProfiles(tx, [profile.id]));
    expect(await userRow(profile.id)).toBeNull();
  });

  it("keeps a reviewed profile, with exactly the roles it was reviewed or linked in", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const reviewedAsLandlord = await createUser({ roles: "both", account: false });
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: reviewedAsLandlord.id });
    const reviewedAsRenter = await createUser({ roles: "both", account: false });
    await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: reviewedAsRenter.id });
    const linked = await createUser({ roles: "both", account: false });
    await insertProperty({ landlordId: linked.id, createdById: renter.id });

    await inTransaction((tx) => reconcileProfiles(tx, [reviewedAsLandlord.id, reviewedAsRenter.id, linked.id]));

    expect(await userRow(reviewedAsLandlord.id)).toMatchObject({ isLandlord: true, isRenter: false });
    expect(await userRow(reviewedAsRenter.id)).toMatchObject({ isLandlord: false, isRenter: true });
    expect(await userRow(linked.id)).toMatchObject({ isLandlord: true, isRenter: false });
  });

  it("leaves accounts alone, even with nothing referring to them", async () => {
    const account = await createUser({ roles: "both" });
    await inTransaction((tx) => reconcileProfiles(tx, [account.id]));
    expect(await userRow(account.id)).toMatchObject({ isLandlord: true, isRenter: true, email: account.email });
  });

  it("keeps a profile that wrote reviews (an account the operator reset), with its reviews", async () => {
    const author = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const reviewId = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: landlord.id });
    const db = await getDb();
    await db
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, author.id));

    await inTransaction((tx) => reconcileProfiles(tx, [author.id]));
    expect(await userRow(author.id)).not.toBeNull();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, reviewId))).toHaveLength(1);
  });

  it("ignores empty, repeated and unknown ids", async () => {
    const profile = await createUser({ roles: "renter", account: false });
    await inTransaction((tx) =>
      reconcileProfiles(tx, [null, undefined, profile.id, profile.id, "00000000-0000-0000-0000-000000000000"]),
    );
    expect(await userRow(profile.id)).toBeNull();
    await expect(inTransaction((tx) => reconcileProfiles(tx, []))).resolves.toBeUndefined();
  });

  it("keeps a profile that something else still refers to, without breaking the caller's transaction", async () => {
    const profile = await createUser({ roles: "renter", account: false });
    const pin = `reconcile_pin_${unique()}`;
    await inRolledBackTransaction(async (tx) => {
      // A reference reconcileProfiles doesn't know about, so its delete fails with 23503.
      await tx.execute(sql.raw(`create table ${pin} (user_id uuid not null references users (id))`));
      await tx.execute(sql.raw(`insert into ${pin} values ('${profile.id}')`));
      await reconcileProfiles(tx, [profile.id]);
      expect(await tx.select({ id: users.id }).from(users).where(eq(users.id, profile.id))).toHaveLength(1);
    });
    expect(await userRow(profile.id)).not.toBeNull();
  });
});

describe("isStillReferenced", () => {
  it("recognises a delete blocked by a reference, as Postgres 17 and 18 report it", () => {
    const blocked = (code: string) => new Error("Failed query", { cause: Object.assign(new Error(code), { code }) });
    expect(isStillReferenced(blocked("23503"))).toBe(true);
    expect(isStillReferenced(blocked("23001"))).toBe(true);
    expect(isStillReferenced(blocked("23505"))).toBe(false);
    expect(isStillReferenced(new Error("plain"))).toBe(false);
  });
});

describe("database errors", () => {
  it("never carry the kennitala that was sent with the query", async () => {
    const person = await createUser({ roles: "landlord", account: false });
    const kennitala = person.kennitala;
    const failures: unknown[] = [];

    await inRolledBackTransaction(async (tx) => {
      // Any statement after a failed one fails, so every query below errors out.
      await tx.execute(sql`select 1 / 0`).catch(() => {});

      // Without sanitizing, the parameters end up in the message.
      const raw = await tx.select().from(users).where(eq(users.kennitala, kennitala)).catch((error) => error);
      expect(String(raw.message)).toContain(kennitala);

      for (const call of [
        () => findPersonByKennitala(kennitala, tx),
        () => ensurePerson(tx, { kennitala, name: "Ný manneskja", isCompany: false, role: "renter" }),
        () => grantRoleByKennitala(tx, kennitala, "renter"),
        () => grantRoleById(tx, person.id, kennitala, "renter"),
      ]) {
        failures.push(await call().then(() => "no error", (error: unknown) => error));
      }
    });

    expect(failures).toHaveLength(4);
    for (const error of failures) {
      expect(error).toBeInstanceOf(Error);
      const { message, stack, cause } = error as Error;
      expect(message).toMatch(/^Database error 25P02/);
      expect(`${message}\n${stack}`).not.toMatch(/\d{10}/);
      expect(cause).toBeUndefined();
    }
  });
});

describe("at the same moment", () => {
  it("two reviewers creating the same new person get one row", async () => {
    for (let i = 0; i < 6; i++) {
      const kennitala = freshKennitala();
      const create = (name: string) =>
        inTransaction(async (tx) => {
          const result = await ensurePerson(tx, { kennitala, name, isCompany: false, role: "landlord" });
          // Hold the row (as a review being written would) for a moment.
          await sleep(5);
          return result;
        });
      const [first, second] = await atOnce(() => create("First Name"), () => create("Second Name"), i);
      expect(first.id).toBe(second.id);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect(await rowsWithKennitala(kennitala)).toHaveLength(1);
    }
  });

  describe.runIf(usingPostgres)("on a real Postgres", () => {
    it("reconcileProfiles skips a profile someone is reviewing right now, which then keeps it", async () => {
      const author = await createUser({ roles: "renter" });
      const profile = await createUser({ roles: "landlord", account: false });
      const locked = deferred();
      const release = deferred();

      // A review in progress: grant the role (locking the row), then insert the review later.
      const reviewing = inTransaction(async (tx) => {
        expect(await grantRoleById(tx, profile.id, profile.kennitala, "landlord")).toBe(true);
        locked.resolve();
        await release.promise;
        await tx.insert(reviews).values({
          kind: "landlord",
          authorId: author.id,
          subjectUserId: profile.id,
          rating: 4,
          title: "Fine",
          body: "A review body that is long enough.",
        });
      });

      await locked.promise;
      // Doesn't wait for the lock, and doesn't delete the row.
      await inTransaction((tx) => reconcileProfiles(tx, [profile.id]));
      release.resolve();
      await reviewing;

      expect(await userRow(profile.id)).toMatchObject({ isLandlord: true });
      const db = await getDb();
      expect(
        await db
          .select({ id: reviews.id })
          .from(reviews)
          .where(and(eq(reviews.subjectUserId, profile.id), eq(reviews.authorId, author.id))),
      ).toHaveLength(1);
    });

    it("ensurePerson creates the profile again if reconcileProfiles deletes it in between", async () => {
      for (const deleteFirst of [true, false]) {
        const profile = await createUser({ roles: "landlord", account: false });
        const locked = deferred();
        const commit = deferred();

        // reconcileProfiles' steps by hand: lock the row, (delete it,) commit later.
        const cleaning = inTransaction(async (tx) => {
          await tx.select({ id: users.id }).from(users).where(eq(users.id, profile.id)).for("update");
          if (deleteFirst) await tx.delete(users).where(eq(users.id, profile.id));
          locked.resolve();
          await commit.promise;
          if (!deleteFirst) await tx.delete(users).where(eq(users.id, profile.id));
        });

        await locked.promise;
        const ensuring = inTransaction((tx) =>
          ensurePerson(tx, { kennitala: profile.kennitala, name: "Ný manneskja", isCompany: false, role: "renter" }),
        );
        // Let ensurePerson reach the locked row and wait there.
        await sleep(100);
        commit.resolve();
        await cleaning;
        const result = await ensuring;

        expect(result.created, `deleteFirst=${deleteFirst}`).toBe(true);
        expect(result.id).not.toBe(profile.id);
        expect(await userRow(result.id)).toMatchObject({ name: "Ný manneskja", isRenter: true, isLandlord: false });
        expect(await rowsWithKennitala(profile.kennitala)).toHaveLength(1);
      }
    });

    it("a property link in progress also keeps its landlord's profile", async () => {
      const renter = await createUser({ roles: "renter" });
      const profile = await createUser({ roles: "renter", account: false });
      const locked = deferred();
      const release = deferred();

      const linking = inTransaction(async (tx) => {
        await ensurePerson(tx, { kennitala: profile.kennitala, name: "Ignored", isCompany: false, role: "landlord" });
        locked.resolve();
        await release.promise;
        await tx.insert(properties).values({
          ...propertyAddressKeys(`Prófunargata ${unique()}`, null),
          postalCode: 101,
          landlordId: profile.id,
          createdById: renter.id,
        });
      });

      await locked.promise;
      await inTransaction((tx) => reconcileProfiles(tx, [profile.id]));
      release.resolve();
      await linking;
      expect(await userRow(profile.id)).toMatchObject({ isLandlord: true, isRenter: true });
    });
  });
});
