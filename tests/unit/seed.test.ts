/**
 * The demo data (src/db/demo-people.ts, inserted by src/db/seed.ts) is
 * consistent, and the site's read queries (src/lib/data.ts) show it as the
 * pages expect: profiles with and without an account, Icelandic search and
 * sorting, and never a kennitala or an email.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";

// Always a fresh embedded database: seedDemoData only fills an empty one.
vi.hoisted(() => {
  delete process.env.UNIT_DATABASE_URL;
});

import { count, eq } from "drizzle-orm";
import {
  DEMO,
  DEMO_PASSWORD,
  DEMO_PEOPLE,
  DEMO_PROPERTIES,
  DEMO_REVIEWS,
  type DemoPersonKey,
  type DemoReview,
} from "@/db/demo-people";
import { properties, reviews, users } from "@/db/schema";
import { seedDemoData } from "@/db/seed";
import { verifyPassword } from "@/lib/auth/password";
import {
  findPropertyByAddress,
  getProperty,
  getPublicUser,
  getRatingSummary,
  getSiteStats,
  listPeople,
  listProperties,
  listRecentReviews,
  listReviewsAbout,
  type PersonListItem,
} from "@/lib/data";
import { containsKennitala, isAdultKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { isHomePostcode, placeName } from "@/lib/postcodes";
import { reviewerRole } from "@/lib/roles";
import { icelandicSortKey, personNameKeys, propertyAddressKeys } from "@/lib/text";
import { getDb } from "./support/harness";

const person = (key: DemoPersonKey) => DEMO_PEOPLE.find((p) => p.key === key)!;
const roleOf = (review: DemoReview) =>
  "landlord" in review ? "landlord" : "renter" in review ? "renter" : "property";
const subjectOf = (review: DemoReview): DemoPersonKey | null =>
  "landlord" in review ? review.landlord : "renter" in review ? review.renter : null;

/** Database ids by demo key, after seeding. */
const ids = new Map<string, string>();

beforeAll(async () => {
  const db = await getDb();
  expect(await seedDemoData(db)).toBe(true);
  for (const row of await db.select({ id: users.id, kennitala: users.kennitala }).from(users)) {
    ids.set(DEMO_PEOPLE.find((p) => p.kennitala === row.kennitala)!.key, row.id);
  }
  for (const row of await db.select().from(properties)) {
    const property = DEMO_PROPERTIES.find(
      (p) => propertyAddressKeys(p.address, "unit" in p ? p.unit : null).addressSearch === row.addressSearch,
    )!;
    ids.set(property.key, row.id);
  }
}, 60_000);

describe("the demo data", () => {
  it("uses valid, adult, distinct kennitalas of the declared type", () => {
    for (const p of DEMO_PEOPLE) {
      const parsed = parseKennitalaInput(p.kennitala);
      expect(parsed?.value, p.key).toBe(p.kennitala);
      expect(parsed?.type, p.key).toBe(p.isCompany ? "company" : "person");
      expect(isAdultKennitala(parsed!), p.key).toBe(true);
    }
    expect(new Set(DEMO_PEOPLE.map((p) => p.kennitala)).size).toBe(DEMO_PEOPLE.length);
    expect(new Set(DEMO_PEOPLE.map((p) => p.key)).size).toBe(DEMO_PEOPLE.length);
  });

  it("gives accounts an email, city and join date, and profiles without one none of them", () => {
    for (const p of DEMO_PEOPLE) {
      const accountFields = [
        "email" in p ? p.email : undefined,
        "city" in p ? p.city : undefined,
        "joinedDaysAgo" in p ? p.joinedDaysAgo : undefined,
      ];
      expect(accountFields.every((field) => field !== undefined), p.key).toBe(p.hasAccount);
      expect(accountFields.every((field) => field === undefined), p.key).toBe(!p.hasAccount);
    }
    const emails = DEMO_PEOPLE.flatMap((p) => ("email" in p ? [p.email] : []));
    expect(new Set(emails).size).toBe(emails.length);
    expect(DEMO.people.sigrun.email).toBe("sigrun@example.com");
  });

  it("has reviews that the app itself would accept", () => {
    for (const review of DEMO_REVIEWS) {
      const label = `${review.author}: ${review.title}`;
      const author = person(review.author);
      expect(author.hasAccount, label).toBe(true);
      expect(author.roles, label).toContain(reviewerRole(roleOf(review)));
      expect(subjectOf(review), label).not.toBe(review.author);
      if ("property" in review) expect(DEMO.properties[review.property].landlord, label).not.toBe(review.author);
      expect(review.title.length >= 3 && review.title.length <= 120, label).toBe(true);
      expect(review.body.length >= 20 && review.body.length <= 5000, label).toBe(true);
      expect(containsKennitala(`${review.title} ${review.body}`), label).toBe(false);
      expect("joinedDaysAgo" in author ? author.joinedDaysAgo : 0, label).toBeGreaterThan(review.daysAgo);
      if ("property" in review) expect(DEMO.properties[review.property].addedDaysAgo, label).toBeGreaterThan(review.daysAgo);
    }
    // One review per author per subject and kind.
    const keys = DEMO_REVIEWS.map((r) => `${r.author}|${roleOf(r)}|${subjectOf(r) ?? ("property" in r && r.property)}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Agnieszka writes the one review in English.
    expect(DEMO_REVIEWS.filter((r) => r.author === "agnieszka")).toHaveLength(1);
  });

  it("has properties at distinct home addresses, added by accounts", () => {
    const keys = DEMO_PROPERTIES.map((p) => {
      expect(isHomePostcode(p.postalCode), p.key).toBe(true);
      expect(person(p.createdBy).hasAccount, p.key).toBe(true);
      return `${propertyAddressKeys(p.address, "unit" in p ? p.unit : null).addressSearch}|${p.postalCode}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only has profiles without an account that someone reviewed or linked to a property", () => {
    for (const p of DEMO_PEOPLE.filter((p) => !p.hasAccount)) {
      const reviewed = DEMO_REVIEWS.some((r) => subjectOf(r) === p.key);
      const linked = DEMO_PROPERTIES.some((property) => property.landlord === p.key);
      expect(reviewed || linked, p.key).toBe(true);
    }
    expect(person("gunnar").hasAccount).toBe(false);
    expect(person("leigufelag")).toMatchObject({ hasAccount: false, isCompany: true });
  });
});

describe("seedDemoData", () => {
  it("inserts every person, property and review once, and does nothing the second time", async () => {
    const db = await getDb();
    const counts = async () => ({
      users: (await db.select({ n: count() }).from(users))[0].n,
      properties: (await db.select({ n: count() }).from(properties))[0].n,
      reviews: (await db.select({ n: count() }).from(reviews))[0].n,
    });
    const expected = { users: DEMO_PEOPLE.length, properties: DEMO_PROPERTIES.length, reviews: DEMO_REVIEWS.length };
    expect(await counts()).toEqual(expected);
    expect(await seedDemoData(db)).toBe(false);
    expect(await counts()).toEqual(expected);
  });

  it("gives everyone exactly their demo roles, which match their reviews and property links", async () => {
    const db = await getDb();
    const rows = await db.select().from(users);
    for (const row of rows) {
      const p = DEMO_PEOPLE.find((candidate) => candidate.kennitala === row.kennitala)!;
      expect({ isLandlord: row.isLandlord, isRenter: row.isRenter }, p.key).toEqual({
        isLandlord: p.roles.includes("landlord" as never),
        isRenter: p.roles.includes("renter" as never),
      });
      const reviewedAs = await db
        .selectDistinct({ kind: reviews.kind })
        .from(reviews)
        .where(eq(reviews.subjectUserId, row.id));
      const linked = await db.select({ id: properties.id }).from(properties).where(eq(properties.landlordId, row.id));
      const earnedLandlord = reviewedAs.some((r) => r.kind === "landlord") || linked.length > 0;
      const earnedRenter = reviewedAs.some((r) => r.kind === "renter");
      // Accounts may have more roles than they've been reviewed in, never fewer.
      if (earnedLandlord) expect(row.isLandlord, p.key).toBe(true);
      if (earnedRenter) expect(row.isRenter, p.key).toBe(true);
      if (row.passwordHash === null) {
        expect({ isLandlord: earnedLandlord, isRenter: earnedRenter }, p.key).toEqual({
          isLandlord: row.isLandlord,
          isRenter: row.isRenter,
        });
      }
    }
  });

  it("stores names, addresses and accounts the way the app writes them", async () => {
    const db = await getDb();
    for (const row of await db.select().from(users)) {
      const p = DEMO_PEOPLE.find((candidate) => candidate.kennitala === row.kennitala)!;
      expect({ name: row.name, nameSort: row.nameSort, nameSearch: row.nameSearch }, p.key).toEqual(
        personNameKeys(p.name),
      );
      expect(row.isCompany, p.key).toBe(p.isCompany);
      if (p.hasAccount) {
        expect(row, p.key).toMatchObject({ email: p.email, city: p.city, bio: p.bio });
        expect(row.joinedAt, p.key).toBeInstanceOf(Date);
        expect(await verifyPassword(DEMO_PASSWORD, row.passwordHash!), p.key).toBe(true);
      } else {
        expect(row, p.key).toMatchObject({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null });
      }
    }
    const njalsgata = await getProperty(ids.get("njalsgata")!);
    expect(njalsgata).toMatchObject({ address: "Njálsgata 23", unit: "0201", postalCode: 101, place: "Reykjavík" });
  });
});

describe("the site's queries over the demo data", () => {
  const names = (items: { name: string }[]) => items.map((item) => item.name);

  it("lists profiles with and without an account in the directories", async () => {
    const landlords = await listPeople({ role: "landlord", sort: "name", pageSize: 100 });
    const expected = DEMO_PEOPLE.filter((p) => (p.roles as readonly string[]).includes("landlord"));
    expect(landlords.total).toBe(expected.length);
    expect(names(landlords.items).sort()).toEqual(expected.map((p) => p.name).sort());

    const gunnar = landlords.items.find((item) => item.id === ids.get("gunnar"))!;
    expect(gunnar).toMatchObject({
      name: "Gunnar Már Pétursson",
      hasAccount: false,
      isCompany: false,
      joinedAt: null,
      city: null,
      reviewCount: 2,
      average: 2.5,
      propertyCount: 1,
    });
    // First reviewed when the earlier of his two reviews was written.
    const firstReview = Math.max(...DEMO_REVIEWS.filter((r) => subjectOf(r) === "gunnar").map((r) => r.daysAgo));
    expect(Date.now() - gunnar.firstReviewedAt!.getTime()).toBeGreaterThan((firstReview - 1) * 24 * 3600 * 1000);

    const sigrun = landlords.items.find((item) => item.id === ids.get("sigrun"))!;
    expect(sigrun).toMatchObject({ hasAccount: true, city: "Reykjavík", propertyCount: 2 });
    expect(sigrun.joinedAt).toBeInstanceOf(Date);
  });

  it("shows the same person on their own page as in the directory", async () => {
    const { items } = await listPeople({ role: "landlord", pageSize: 100 });
    for (const item of items) expect(item, item.name).toMatchObject((await getPublicUser(item.id))!);
    expect((await getPublicUser(ids.get("gunnar")!))!.firstReviewedAt).toBeInstanceOf(Date);
    // Nobody has reviewed Helga.
    expect((await getPublicUser(ids.get("helga")!))!.firstReviewedAt).toBeNull();
    expect(await getPublicUser("not-a-uuid")).toBeNull();
    expect(await getPublicUser("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("sorts by name A–Ö", async () => {
    for (const role of ["landlord", "renter"] as const) {
      const { items } = await listPeople({ role, sort: "name", pageSize: 100 });
      const expected = [...names(items)].sort((a, b) => (icelandicSortKey(a) < icelandicSortKey(b) ? -1 : 1));
      expect(names(items), role).toEqual(expected);
    }
    const renters = names((await listPeople({ role: "renter", sort: "name", pageSize: 100 })).items);
    // Á after A, Þ after every Latin letter.
    expect(renters.indexOf("Ásdís Halldórsdóttir")).toBeGreaterThan(renters.indexOf("Agnieszka Nowak"));
    expect(renters.at(-1)).toBe("Þórdís Eva Jóhannsdóttir");
  });

  it("finds people by name or city, without accents", async () => {
    const search = async (role: "landlord" | "renter", query: string) =>
      names((await listPeople({ role, query, pageSize: 100 })).items).sort();
    expect(await search("renter", "thordis")).toEqual(["Þórdís Eva Jóhannsdóttir"]);
    expect(await search("renter", "THÓRDÍS")).toEqual(["Þórdís Eva Jóhannsdóttir"]);
    expect(await search("landlord", "gunnar")).toEqual(["Gunnar Már Pétursson", "Ólafur Þór Gunnarsson"]);
    expect(await search("landlord", "gunnar mar")).toEqual(["Gunnar Már Pétursson"]);
    expect(await search("landlord", "leigufelag")).toEqual(["Dæmi leigufélag ehf."]);
    // City (accounts only), accent-insensitive, combined with a name.
    expect(await search("renter", "reykjavik")).toEqual(["Eva María Guðmundsdóttir"]);
    expect(await search("landlord", "Hafnarfjordur")).toEqual(["Helga Rún Sigurðardóttir"]);
    expect(await search("renter", "akureyri birta")).toEqual(["Birta Líf Kristinsdóttir"]);
    expect(await search("landlord", "zzz")).toEqual([]);
  });

  it("lists properties with their place and landlord, and whether that landlord confirmed it", async () => {
    const { items, total } = await listProperties({ sort: "name", pageSize: 100 });
    expect(total).toBe(DEMO_PROPERTIES.length);
    const hamraborg = items.find((p) => p.id === ids.get("hamraborg"))!;
    expect(hamraborg).toMatchObject({
      address: "Hamraborg 14",
      unit: "0503",
      postalCode: 200,
      place: "Kópavogur",
      landlord: { id: ids.get("gunnar"), name: "Gunnar Már Pétursson", hasAccount: false },
      createdById: ids.get("kari"),
      reviewCount: 1,
      average: 2,
    });
    expect(items.find((p) => p.id === ids.get("njalsgata"))!.landlord).toEqual({
      id: ids.get("sigrun"),
      name: "Sigrún Helgadóttir",
      hasAccount: true,
      // She listed it herself.
      confirmed: true,
    });
    // A–Ö by address: Þórunnarstræti comes last.
    expect(items.map((p) => p.address).at(-1)).toBe("Þórunnarstræti 112");
    expect(items.map((p) => p.address).slice(0, 2)).toEqual(["Austurvegur 22", "Hafnargata 50"]);
  });

  it("finds properties by address, apartment, postcode or place", async () => {
    const search = async (query: string) =>
      (await listProperties({ query, pageSize: 100 })).items.map((p) => p.address).sort();
    expect(await search("kopavogur")).toEqual(["Hamraborg 14"]);
    expect(await search("101")).toEqual(["Njálsgata 23"]);
    expect(await search("njalsgata 0201")).toEqual(["Njálsgata 23"]);
    expect(await search("Selfoss Austurvegur")).toEqual(["Austurvegur 22"]);
    expect(await search("AKUREYRI")).toEqual(["Þórunnarstræti 112"]);
    expect(await search("gata")).toEqual(["Hafnargata 50", "Njálsgata 23", "Strandgata 31"]);
    expect(await search("njalsgata 600")).toEqual([]);
  });

  it("filters properties by landlord and creator", async () => {
    const byLandlord = await listProperties({ landlordId: ids.get("leigufelag"), sort: "name" });
    expect(byLandlord.items.map((p) => p.address)).toEqual(["Hafnargata 50", "Strandgata 31"]);
    const addedByOthers = await listProperties({ createdById: ids.get("olafur"), notLandlordId: ids.get("olafur") });
    expect(addedByOthers.items.map((p) => p.address)).toEqual(["Hringbraut 79"]);
  });

  it("finds an existing property however its address is typed", async () => {
    expect(await findPropertyByAddress({ address: "NJÁLSGATA  23", unit: "íbúð 0201", postalCode: 101 })).toEqual({
      id: ids.get("njalsgata"),
    });
    expect(await findPropertyByAddress({ address: "Njalsgata 23", unit: "0201", postalCode: 107 })).toBeNull();
    expect(await findPropertyByAddress({ address: "Njálsgata 23", unit: null, postalCode: 101 })).toBeNull();
  });

  it("describes what each review is about, people by name and properties by address", async () => {
    const recent = await listRecentReviews(100);
    expect(recent).toHaveLength(DEMO_REVIEWS.length);
    const english = recent.find((r) => r.author.id === ids.get("agnieszka"))!;
    expect(english.subject).toEqual({
      kind: "property",
      id: ids.get("hafnargata"),
      address: "Hafnargata 50",
      unit: null,
      postalCode: 230,
      place: placeName(230),
    });
    expect(english.author).toMatchObject({ name: "Agnieszka Nowak", role: "renter" });

    const aboutMagnus = await listReviewsAbout({ userId: ids.get("magnus")!, as: "renter" });
    expect(aboutMagnus.items.map((r) => r.subject)).toEqual([
      { kind: "renter", id: ids.get("magnus"), name: "Magnús Örn Stefánsson" },
    ]);
    expect(await getRatingSummary({ userId: ids.get("gunnar")!, as: "landlord" })).toEqual({
      average: 2.5,
      count: 2,
      distribution: [0, 1, 1, 0, 0],
    });
  });

  it("never returns a kennitala, an email or a password hash", async () => {
    const results: unknown[] = [
      await listPeople({ role: "landlord", pageSize: 100 }),
      await listPeople({ role: "renter", pageSize: 100 }),
      await listProperties({ pageSize: 100 }),
      await listRecentReviews(100),
      ...(await Promise.all(DEMO_PEOPLE.map((p) => getPublicUser(ids.get(p.key)!)))),
    ];
    const json = JSON.stringify(results);
    for (const p of DEMO_PEOPLE) expect(json, p.key).not.toContain(p.kennitala);
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("scrypt$");
    const user = (await getPublicUser(ids.get("sigrun")!)) as PersonListItem;
    expect(Object.keys(user).sort()).toEqual(
      ["bio", "city", "firstReviewedAt", "hasAccount", "id", "isCompany", "isLandlord", "isRenter", "joinedAt", "name"].sort(),
    );
  });

  it("counts people with or without an account on the home page", async () => {
    const withRole = (role: string) => DEMO_PEOPLE.filter((p) => (p.roles as readonly string[]).includes(role)).length;
    expect(await getSiteStats()).toEqual({
      landlords: withRole("landlord"),
      renters: withRole("renter"),
      properties: DEMO_PROPERTIES.length,
      reviews: DEMO_REVIEWS.length,
    });
  });
});
