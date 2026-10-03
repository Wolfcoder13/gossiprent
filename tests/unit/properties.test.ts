/**
 * Properties (src/app/actions/properties.ts, spec §6): adding one (own or rent,
 * Icelandic addresses and postcodes, duplicates), linking its landlord by
 * kennitala (someone on GossipRent, or a new profile without an account), the
 * "Check" button, claiming ("I manage this property"), unlinking ("Not my
 * property"), the creator changing the landlord while it has no account, and
 * the language of the messages.
 *
 * The races at the end only really race on a real Postgres (UNIT_DATABASE_URL;
 * see support/harness.ts); the embedded database runs one transaction at a time.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./support/next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("./support/next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("./support/next-mocks")).nextCacheMock);
// Unchanged, but replaceable once per test: lets a test make the lookup see a
// person who is gone by the time the property is saved.
vi.mock("@/lib/people", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/people")>();
  return { ...actual, findPersonByKennitala: vi.fn(actual.findPersonByKennitala) };
});

import { randomUUID } from "node:crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { changeRole } from "@/app/actions/account";
import { createProperty, updatePropertyLandlord, type PropertyFormState } from "@/app/actions/properties";
import { saveReview } from "@/app/actions/reviews";
import { authAttempts, properties, reviews, users } from "@/db/schema";
import { createFormat } from "@/i18n/format";
import { idleFormState, type FormState } from "@/lib/form-state";
import { formatKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { findPersonByKennitala } from "@/lib/people";
import {
  asVisitor,
  atOnce,
  attemptsFor,
  createUser,
  currentVisitor,
  form,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  logInAs,
  newVisitor,
  outcome,
  seedAttempts,
  unique,
  userRow,
  usingPostgres,
  type TestUser,
} from "./support/harness";

// ---------------------------------------------------------------------------
// Messages (English: the harness's visitors have lang=en)
// ---------------------------------------------------------------------------

const LOG_IN = "Please log in to add a property.";
const LOG_IN_AGAIN = "Please log in again.";
const FIX = "Please fix the highlighted fields.";
const TRY_LATER = "Too many attempts. Please try again later.";
const ALREADY_LISTED = "This property is already listed on GossipRent.";
const CLAIMABLE = "This property is already listed, without a landlord. If you manage it, you can claim it.";
const CHOOSE_RELATION = "Choose whether you own or rent this place.";
const OWN_KENNITALA = "That's your own kennitala. You can't be the landlord of a place you rent.";
const MINOR = "This kennitala can't be linked as a landlord.";
const NAME_REQUIRED = "Nobody with this kennitala is on GossipRent yet. Enter the landlord's name.";
const CONFIRM_REQUIRED = "Tick the box to confirm the kennitala is right.";
const PERSON_CHARS = "Use only letters, spaces, hyphens, apostrophes and periods in a name.";
const MISSING = "That property doesn't exist.";
const CLAIMED = "Done. You're now listed as this property's landlord.";
const ONLY_LANDLORDS_CLAIM = "Only landlords can claim a property.";
const ALREADY_MANAGED = "Another landlord already manages this property.";
const CLAIM_AFTER_REVIEW =
  "You've reviewed this property as a renter, so you can't also be its landlord. Delete your review first.";
const UNLINKED = "Done. You're no longer listed as this property's landlord.";
const NOT_LISTED = "You aren't listed as this property's landlord.";
const RELINKED = "Done. The property's landlord was changed.";
const RELINK_CLEARED = "Done. The property no longer has a landlord linked.";
const NOT_CREATOR = "You can only change the landlord of a property you added.";
const HAS_ACCOUNT =
  "The landlord has a GossipRent account, so only they can remove the link (with “Not my property”). If it's wrong, report this page.";
const ONLY_LANDLORDS_OWN = "Only landlords can list a property as their own.";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Result = PropertyFormState | { redirect: string; type?: "push" | "replace" };

/** Submit the add-a-property form as the current visitor; a fresh address in 101 unless given. */
function add(fields: Record<string, string | undefined> = {}): Promise<Result> {
  return outcome(
    createProperty(
      idleFormState,
      form({ address: `Prófunargata ${unique()}`, unit: "", postalCode: "101", description: "", ...fields }),
    ),
  );
}

/** The id of the property a successful add redirected to. */
function addedId(result: Result): string {
  expect(result).toEqual({ redirect: expect.stringMatching(/^\/properties\/[0-9a-f-]{36}$/) });
  return (result as { redirect: string }).redirect.split("/")[2];
}

/** Add a property and return its landlord (or the refusal). */
async function addAndGetLandlord(fields: Record<string, string | undefined> = {}) {
  const result = await add(fields);
  if (!("redirect" in result)) return result;
  return { landlordId: await landlordOf(addedId(result)) };
}

/** "Check" on the add-a-property form. */
function check(kennitala: string, fields: Record<string, string> = {}): Promise<PropertyFormState> {
  return createProperty(idleFormState, form({ intent: "check", landlordKennitala: kennitala, ...fields }));
}

/** A landlord control on a property page: claim, unlink, relink or check. */
function landlordAction(
  intent: string,
  propertyId: string | undefined,
  fields: Record<string, string> = {},
): Promise<PropertyFormState> {
  return updatePropertyLandlord(idleFormState, form({ intent, propertyId, ...fields }));
}

/** The creator changes the landlord to this kennitala (empty: none), naming a new one. */
function relink(propertyId: string, kennitala: string, name?: string): Promise<PropertyFormState> {
  return landlordAction("relink", propertyId, {
    landlordKennitala: kennitala,
    ...(name ? { landlordName: name, confirmNewLandlord: "on" } : {}),
  });
}

async function propertyRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(properties).where(eq(properties.id, id));
  return row ?? null;
}

async function landlordOf(propertyId: string): Promise<string | null> {
  return (await propertyRow(propertyId))!.landlordId;
}

async function createdBy(userId: string): Promise<number> {
  const db = await getDb();
  return (await db.select({ id: properties.id }).from(properties).where(eq(properties.createdById, userId))).length;
}

async function idsWithKennitala(kennitala: string): Promise<string[]> {
  const db = await getDb();
  return (await db.select({ id: users.id }).from(users).where(eq(users.kennitala, kennitala))).map((row) => row.id);
}

/** How a person's birth date is shown in a lookup (English). */
function born(kennitala: string, locale: "en" | "is" = "en"): string {
  return createFormat(locale).date(parseKennitalaInput(kennitala)!.birthDate!);
}

/** Kennitala checks counted for this user (the 15-minute window). */
function checksBy(user: { id: string }): Promise<number> {
  return attemptsFor(`kt:user15:${user.id}`);
}

/** Read the rest of this test in Icelandic (no language cookie: the site's default). */
function inIcelandic(): void {
  currentVisitor().cookies.delete("lang");
}

/** Submit a property review as the current visitor. */
function reviewProperty(propertyId: string): Promise<FormState> {
  return saveReview(
    idleFormState,
    form({
      kind: "property",
      subjectId: propertyId,
      rating: "4",
      title: `Umsögn ${unique()}`,
      body: "Nógu löng umsögn um eignina til að standast reglurnar.",
    }),
  );
}

/** Give a profile without an account an account, as signing up with its kennitala would. */
async function takeOver(user: TestUser): Promise<void> {
  const db = await getDb();
  await db
    .update(users)
    .set({ email: `taken-${unique()}@example.com`, passwordHash: "not-a-real-hash", joinedAt: new Date() })
    .where(eq(users.id, user.id));
}

// ---------------------------------------------------------------------------
// Adding a property
// ---------------------------------------------------------------------------

describe("createProperty", () => {
  it("asks signed-out visitors to log in", async () => {
    expect(await add()).toEqual({ status: "error", message: LOG_IN });
    expect(await check(freshKennitala())).toEqual({ status: "error", message: LOG_IN });
  });

  it("adds the place a renter rents, tidying the address and storing its search keys", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const token = unique();
    const id = addedId(
      await add({
        address: `  Njálsgata   ${token} `,
        unit: " íbúð  0201 ",
        postalCode: "101",
        description: " Björt íbúð með útsýni ",
      }),
    );
    expect(await propertyRow(id)).toMatchObject({
      address: `Njálsgata ${token}`,
      unit: "0201",
      postalCode: 101,
      description: "Björt íbúð með útsýni",
      landlordId: null,
      createdById: renter.id,
      addressSearch: `njalsgata ${token} 0201`,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/properties");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("stores the apartment without “íbúð”, “íb.”, “apt” or “#”, and other units as typed", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    for (const [typed, stored] of [
      ["íb. 0302", "0302"],
      ["apt 4", "4"],
      ["#5", "5"],
      ["2. hæð til vinstri", "2. hæð til vinstri"],
      ["", null],
    ] as const) {
      const id = addedId(await add({ unit: typed }));
      expect((await propertyRow(id))!.unit, typed).toBe(stored);
    }
  });

  it("validates the fields, keeping what was typed", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await add({ address: " ", postalCode: "", unit: "7", description: "Hálf útfyllt" })).toEqual({
      status: "error",
      message: FIX,
      fieldErrors: { address: ["Enter the street address."], postalCode: ["Choose a postcode."] },
      values: { address: " ", postalCode: "", unit: "7", description: "Hálf útfyllt" },
    });
    // A PO-box-only postcode, an unknown one, or anything else isn't on the list.
    for (const postalCode of ["121", "999", "10a", "1010"]) {
      expect(await add({ postalCode }), postalCode).toMatchObject({
        fieldErrors: { postalCode: ["Choose a postcode from the list."] },
      });
    }
    expect(await add({ description: `Leigusalinn er ${formatKennitala(freshKennitala())}` })).toMatchObject({
      fieldErrors: { description: ["Don't include a kennitala here. ID numbers are never shown on GossipRent."] },
    });
    expect(await add({ unit: "x".repeat(31) })).toMatchObject({
      fieldErrors: { unit: ["Apartment must be 30 characters or fewer."] },
    });
    expect(await createdBy(renter.id)).toBe(0);
  });
});

describe("createProperty: an address that's already listed", () => {
  it("is the same address however it's capitalized or prefixed (“ÁLFHEIMAR 3” is “Álfheimar 3”, “íbúð 0201” is “0201”)", async () => {
    const token = unique();
    const existing = await insertProperty({
      landlordId: null,
      createdById: null,
      address: `Álfheimar ${token}`,
      unit: "0201",
      postalCode: 104,
    });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const typed = { address: `  ÁLFHEIMAR  ${token.toUpperCase()}`, unit: "íbúð 0201", postalCode: "104" };
    expect(await add({ ...typed, description: "Önnur lýsing" })).toEqual({
      status: "error",
      message: ALREADY_LISTED,
      link: { href: `/properties/${existing.id}`, label: "Go to the existing listing" },
      // What was typed comes back.
      values: { ...typed, description: "Önnur lýsing" },
    });
    expect(await add({ address: `alfheimar ${token}`, unit: "0201", postalCode: "104" })).toMatchObject({
      message: ALREADY_LISTED,
    });
    // Another apartment, no apartment, or another postcode is another property.
    addedId(await add({ address: `Álfheimar ${token}`, unit: "0202", postalCode: "104" }));
    addedId(await add({ address: `Álfheimar ${token}`, unit: "", postalCode: "104" }));
    addedId(await add({ address: `Álfheimar ${token}`, unit: "0201", postalCode: "105" }));
  });

  it("points a landlord at a listing without a landlord, to claim it", async () => {
    const unclaimed = await insertProperty({ landlordId: null, createdById: null });
    const owner = await createUser({ roles: "landlord" });
    const managed = await insertProperty({ landlordId: owner.id, createdById: owner.id });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    expect(await add({ address: unclaimed.address })).toMatchObject({
      status: "error",
      message: CLAIMABLE,
      link: { href: `/properties/${unclaimed.id}`, label: "Go to the listing to claim it" },
    });
    expect(await add({ address: managed.address })).toMatchObject({
      message: ALREADY_LISTED,
      link: { href: `/properties/${managed.id}`, label: "Go to the existing listing" },
    });
    // A renter isn't offered the claim.
    await logInAs(await createUser({ roles: "renter" }));
    expect(await add({ address: unclaimed.address })).toMatchObject({ message: ALREADY_LISTED });
  });

  it("is reported before the landlord's kennitala is looked up or anything is written", async () => {
    const existing = await insertProperty({ landlordId: null, createdById: null });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    expect(
      await add({
        address: existing.address,
        landlordKennitala: kennitala,
        landlordName: "Nýr Leigusali",
        confirmNewLandlord: "on",
      }),
    ).toMatchObject({ status: "error", message: ALREADY_LISTED });
    expect(await checksBy(renter)).toBe(0);
    expect(await idsWithKennitala(kennitala)).toEqual([]);
  });
});

describe("createProperty: own or rent", () => {
  it("someone with both roles must choose; nothing is added until they do", async () => {
    const user = await createUser({ roles: "both" });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(user);
    const address = `Óákveðnagata ${unique()}`;
    expect(await add({ address })).toMatchObject({
      status: "error",
      message: FIX,
      fieldErrors: { relation: [CHOOSE_RELATION] },
      values: { address },
    });
    // Even with a landlord's kennitala filled in.
    expect(await add({ landlordKennitala: landlord.kennitala })).toMatchObject({
      fieldErrors: { relation: [CHOOSE_RELATION] },
    });
    expect(await createdBy(user.id)).toBe(0);
  });

  it("rejects a relation that isn't own or rent", async () => {
    const user = await createUser({ roles: "both" });
    await logInAs(user);
    expect(await add({ relation: "manage" })).toMatchObject({
      status: "error",
      fieldErrors: { relation: [CHOOSE_RELATION] },
    });
    expect(await createdBy(user.id)).toBe(0);
  });

  it("“own” lists it as theirs, whatever the (hidden) landlord fields hold", async () => {
    const user = await createUser({ roles: "both" });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(user);
    expect(await addAndGetLandlord({ relation: "own" })).toEqual({ landlordId: user.id });
    expect(await addAndGetLandlord({ relation: "own", landlordKennitala: landlord.kennitala })).toEqual({
      landlordId: user.id,
    });
    // Not even an invalid kennitala or a missing confirmation gets in the way.
    expect(
      await addAndGetLandlord({ relation: "own", landlordKennitala: "123", landlordName: "1", confirmNewLandlord: "x" }),
    ).toEqual({ landlordId: user.id });
    expect(await checksBy(user)).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${user.id}`);
  });

  it("“rent” links the landlord by kennitala, or none", async () => {
    const user = await createUser({ roles: "both" });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(user);
    expect(await addAndGetLandlord({ relation: "rent" })).toEqual({ landlordId: null });
    expect(await addAndGetLandlord({ relation: "rent", landlordKennitala: "" })).toEqual({ landlordId: null });
    expect(await addAndGetLandlord({ relation: "rent", landlordKennitala: landlord.kennitala })).toEqual({
      landlordId: landlord.id,
    });
  });

  it("a place they rent can then be reviewed by them; one they own can't", async () => {
    const user = await createUser({ roles: "both" });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(user);
    const rented = addedId(await add({ relation: "rent", landlordKennitala: landlord.kennitala }));
    const owned = addedId(await add({ relation: "own" }));
    expect(await reviewProperty(rented)).toMatchObject({ status: "success" });
    expect(await reviewProperty(owned)).toMatchObject({ status: "error" });
  });

  it("a renter-only user isn't asked to choose; “own” can't make them the landlord", async () => {
    const user = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    await logInAs(user);
    expect(await addAndGetLandlord({ relation: "own" })).toEqual({ landlordId: null });
    expect(await addAndGetLandlord({ landlordKennitala: landlord.kennitala })).toEqual({ landlordId: landlord.id });
    expect(await addAndGetLandlord({})).toEqual({ landlordId: null });
  });

  it("a landlord-only user always lists it as their own, even if the form says rent", async () => {
    const user = await createUser({ roles: "landlord" });
    const other = await createUser({ roles: "landlord" });
    await logInAs(user);
    expect(await addAndGetLandlord({})).toEqual({ landlordId: user.id });
    expect(await addAndGetLandlord({ relation: "rent" })).toEqual({ landlordId: user.id });
    expect(await addAndGetLandlord({ relation: "rent", landlordKennitala: other.kennitala })).toEqual({
      landlordId: user.id,
    });
    expect(await checksBy(user)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The landlord's kennitala
// ---------------------------------------------------------------------------

describe("createProperty: the landlord's kennitala", () => {
  it("links a landlord who has an account, however the kennitala is typed", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const [a, b] = [landlord.kennitala.slice(0, 6), landlord.kennitala.slice(6)];
    for (const typed of [landlord.kennitala, `${a}-${b}`, ` ${a} ${b} `]) {
      expect(await addAndGetLandlord({ landlordKennitala: typed }), typed).toEqual({ landlordId: landlord.id });
    }
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true, isRenter: false });
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
    // Every lookup counts.
    expect(await checksBy(renter)).toBe(3);
  });

  it("links a landlord's profile without an account, without a second row", async () => {
    const profile = await createUser({ roles: "landlord", account: false });
    await logInAs(await createUser({ roles: "renter" }));
    // A name typed by mistake is ignored: the profile keeps its own.
    expect(await addAndGetLandlord({ landlordKennitala: profile.kennitala, landlordName: "Annað Nafn" })).toEqual({
      landlordId: profile.id,
    });
    expect(await idsWithKennitala(profile.kennitala)).toEqual([profile.id]);
    expect(await userRow(profile.id)).toMatchObject({ name: profile.name, passwordHash: null });
  });

  it("gives a renter-only account the landlord role", async () => {
    const other = await createUser({ roles: "renter" });
    await logInAs(await createUser({ roles: "renter" }));
    expect(await addAndGetLandlord({ landlordKennitala: other.kennitala })).toEqual({ landlordId: other.id });
    expect(await userRow(other.id)).toMatchObject({ isLandlord: true, isRenter: true, email: other.email });
  });

  it("gives a renter-only profile without an account the landlord role", async () => {
    const other = await createUser({ roles: "renter", account: false });
    await logInAs(await createUser({ roles: "renter" }));
    expect(await addAndGetLandlord({ landlordKennitala: other.kennitala })).toEqual({ landlordId: other.id });
    expect(await userRow(other.id)).toMatchObject({ isLandlord: true, isRenter: true, email: null });
  });

  it("a new kennitala needs the landlord's name and a confirmation, then makes a profile without an account", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    const address = `Nýjagata ${unique()}`;

    expect(await add({ address, landlordKennitala: kennitala })).toEqual({
      status: "error",
      message: FIX,
      fieldErrors: { landlordName: [NAME_REQUIRED] },
      values: { address, unit: "", postalCode: "101", description: "", landlordKennitala: kennitala },
      landlord: { found: false, name: null, isCompany: false, birthDate: born(kennitala) },
    });
    expect(await add({ address, landlordKennitala: kennitala, landlordName: "Gunnar Prófunarson" })).toMatchObject({
      status: "error",
      fieldErrors: { confirmNewLandlord: [CONFIRM_REQUIRED] },
      landlord: { found: false },
    });
    expect(await idsWithKennitala(kennitala)).toEqual([]);
    expect(await createdBy(renter.id)).toBe(0);
    expect(await attemptsFor(`profile-new:user:${renter.id}`)).toBe(0);

    const id = addedId(
      await add({
        address,
        landlordKennitala: formatKennitala(kennitala),
        landlordName: "  Gunnar   Prófunarson ",
        confirmNewLandlord: "on",
      }),
    );
    const [profileId] = await idsWithKennitala(kennitala);
    expect(await landlordOf(id)).toBe(profileId);
    expect(await userRow(profileId)).toMatchObject({
      name: "Gunnar Prófunarson",
      isLandlord: true,
      isRenter: false,
      isCompany: false,
      email: null,
      passwordHash: null,
      joinedAt: null,
    });
    expect(await attemptsFor(`profile-new:user:${renter.id}`)).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${profileId}`);
  });

  it("a company's kennitala makes a company profile, whose name may have digits and “&”", async () => {
    await logInAs(await createUser({ roles: "renter" }));
    const kennitala = freshKennitala("company");
    expect(await check(kennitala)).toMatchObject({
      landlord: { found: false, name: null, isCompany: true, birthDate: null },
    });
    const id = addedId(
      await add({ landlordKennitala: kennitala, landlordName: "Prófun 2 & synir ehf.", confirmNewLandlord: "on" }),
    );
    expect(await userRow((await landlordOf(id))!)).toMatchObject({
      name: "Prófun 2 & synir ehf.",
      isCompany: true,
      isLandlord: true,
      kennitala,
    });
  });

  it("a person's name can't have digits or “&”", async () => {
    await logInAs(await createUser({ roles: "renter" }));
    const kennitala = freshKennitala();
    expect(await add({ landlordKennitala: kennitala, landlordName: "Jón 2", confirmNewLandlord: "on" })).toMatchObject({
      status: "error",
      fieldErrors: { landlordName: [PERSON_CHARS] },
    });
    expect(await idsWithKennitala(kennitala)).toEqual([]);
  });

  it("refuses your own kennitala, however it's typed, without looking it up", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    for (const typed of [renter.kennitala, formatKennitala(renter.kennitala)]) {
      expect(await add({ landlordKennitala: typed }), typed).toMatchObject({
        status: "error",
        message: FIX,
        fieldErrors: { landlordKennitala: [OWN_KENNITALA] },
      });
    }
    expect(await checksBy(renter)).toBe(0);
    expect(await createdBy(renter.id)).toBe(0);
  });

  it("refuses a minor's kennitala with a neutral message, creating nothing", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala("minor");
    const fields = { landlordKennitala: kennitala, landlordName: "Barn Prófun", confirmNewLandlord: "on" };
    expect(await add(fields)).toMatchObject({ status: "error", fieldErrors: { landlordKennitala: [MINOR] } });
    expect(await check(kennitala)).toMatchObject({ status: "error", fieldErrors: { landlordKennitala: [MINOR] } });
    expect(await idsWithKennitala(kennitala)).toEqual([]);
    expect(await createdBy(renter.id)).toBe(0);
    expect(await checksBy(renter)).toBe(0);
  });

  it("refuses a kennitala that can't be real", async () => {
    await logInAs(await createUser({ roles: "renter" }));
    expect(await add({ landlordKennitala: "123456-7890" })).toMatchObject({
      fieldErrors: { landlordKennitala: ["That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890."] },
    });
  });

  it("limits how many new profiles one person creates", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(`profile-new:user:${renter.id}`, 5);
    const kennitala = freshKennitala();
    expect(
      await add({ landlordKennitala: kennitala, landlordName: "Sjötti Nýi", confirmNewLandlord: "on" }),
    ).toMatchObject({ status: "error", message: TRY_LATER, landlord: { found: false } });
    expect(await idsWithKennitala(kennitala)).toEqual([]);
    expect(await createdBy(renter.id)).toBe(0);
    // Linking someone already on GossipRent isn't a new profile.
    const landlord = await createUser({ roles: "landlord" });
    expect(await addAndGetLandlord({ landlordKennitala: landlord.kennitala })).toEqual({ landlordId: landlord.id });
  });

  it("is refused over the kennitala-check limit, and nothing is linked", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(`kt:user15:${renter.id}`, 10);
    expect(await add({ landlordKennitala: landlord.kennitala })).toMatchObject({ status: "error", message: TRY_LATER });
    expect(await createdBy(renter.id)).toBe(0);
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: false });
  });

  it("someone found at lookup but deleted before the save: asks for a name, as for a new kennitala", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    const kennitala = freshKennitala();
    vi.mocked(findPersonByKennitala).mockResolvedValueOnce({
      id: randomUUID(),
      name: "Horfinn Prófun",
      isLandlord: true,
      isRenter: false,
      isCompany: false,
      hasAccount: false,
    });
    expect(await add({ landlordKennitala: kennitala })).toMatchObject({
      status: "error",
      fieldErrors: { landlordName: [NAME_REQUIRED] },
      landlord: { found: false, birthDate: born(kennitala) },
    });
    expect(await createdBy(renter.id)).toBe(0);
    expect(await idsWithKennitala(kennitala)).toEqual([]);
  });
});

describe("createProperty: the Check button", () => {
  it("says who the kennitala belongs to and saves nothing; the lookup counts", async () => {
    const landlord = await createUser({ roles: "landlord", name: "Sigrún Prófunardóttir" });
    const renter = await createUser({ roles: "renter" });
    const visitor = await logInAs(renter);
    const address = `Athugunargata ${unique()}`;
    expect(await check(landlord.kennitala, { address, postalCode: "101" })).toEqual({
      status: "idle",
      // The author's own form echo, formatted.
      values: { intent: "check", landlordKennitala: formatKennitala(landlord.kennitala), address, postalCode: "101" },
      landlord: { found: true, name: "Sigrún Prófunardóttir", isCompany: false, birthDate: null },
    });
    expect(await createdBy(renter.id)).toBe(0);
    expect(await checksBy(renter)).toBe(1);
    expect(await attemptsFor(`kt:userday:${renter.id}`)).toBe(1);
    expect(await attemptsFor(`kt:ip:${visitor.ip}`)).toBe(1);
    // Rate-limit keys never contain the kennitala.
    const db = await getDb();
    expect(
      await db.select({ key: authAttempts.key }).from(authAttempts).where(like(authAttempts.key, `%${landlord.kennitala}%`)),
    ).toEqual([]);
  });

  it("says when nobody has the kennitala yet, with the date of birth to spot a typo, and creates nothing", async () => {
    await logInAs(await createUser({ roles: "renter" }));
    const kennitala = freshKennitala();
    expect(await check(formatKennitala(kennitala))).toMatchObject({
      status: "idle",
      landlord: { found: false, name: null, isCompany: false, birthDate: born(kennitala) },
    });
    expect(await idsWithKennitala(kennitala)).toEqual([]);
  });

  it("needs only the kennitala, and says when it's missing or invalid", async () => {
    await logInAs(await createUser({ roles: "renter" }));
    expect(await check("")).toMatchObject({
      status: "error",
      fieldErrors: { landlordKennitala: ["Enter a kennitala."] },
    });
    expect(await check("12345")).toMatchObject({
      fieldErrors: { landlordKennitala: ["That isn't a valid kennitala. Enter 10 digits, e.g. 123456-7890."] },
    });
  });

  it("refuses your own kennitala without counting a lookup", async () => {
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    expect(await check(renter.kennitala)).toMatchObject({ fieldErrors: { landlordKennitala: [OWN_KENNITALA] } });
    expect(await checksBy(renter)).toBe(0);
  });

  it("is rate limited per user (15 minutes and a day) and per network", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    await seedAttempts(`kt:user15:${renter.id}`, 9);
    expect(await check(landlord.kennitala)).toMatchObject({ status: "idle", landlord: { found: true } });
    expect(await check(landlord.kennitala)).toEqual({
      status: "error",
      message: TRY_LATER,
      values: { intent: "check", landlordKennitala: landlord.kennitala },
    });

    const second = await createUser({ roles: "renter" });
    await logInAs(second);
    await seedAttempts(`kt:userday:${second.id}`, 50);
    expect(await check(landlord.kennitala)).toMatchObject({ message: TRY_LATER });

    const third = await createUser({ roles: "renter" });
    await logInAs(third);
    await seedAttempts(`kt:ip:${currentVisitor().ip}`, 100);
    expect(await check(landlord.kennitala)).toMatchObject({ message: TRY_LATER });
  });
});

// ---------------------------------------------------------------------------
// Claim: "I manage this property"
// ---------------------------------------------------------------------------

describe("claim", () => {
  it("lets a landlord claim a property without a landlord, and says so", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: renter.id });
    await logInAs(landlord);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(property.id)).toBe(landlord.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${property.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
  });

  it("never takes over a property that already has a landlord, with or without an account", async () => {
    const owner = await createUser({ roles: "landlord" });
    const profile = await createUser({ roles: "landlord", account: false });
    const intruder = await createUser({ roles: "landlord" });
    const managed = await insertProperty({ landlordId: owner.id, createdById: owner.id });
    const linked = await insertProperty({ landlordId: profile.id, createdById: null });
    await logInAs(intruder);
    for (const property of [managed, linked]) {
      expect(await landlordAction("claim", property.id)).toEqual({ status: "error", message: ALREADY_MANAGED });
    }
    expect(await landlordOf(managed.id)).toBe(owner.id);
    expect(await landlordOf(linked.id)).toBe(profile.id);
  });

  it("only the first of two landlords claiming at once wins", async () => {
    const first = await createUser({ roles: "landlord" });
    const second = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: null, createdById: null });
    const asFirst = await logInAs(first);
    const asSecond = await logInAs(second);
    const results = await atOnce(
      () => asVisitor(asFirst, () => landlordAction("claim", property.id)),
      () => asVisitor(asSecond, () => landlordAction("claim", property.id)),
    );
    expect(results.map((r) => r.message).sort()).toEqual([ALREADY_MANAGED, CLAIMED].sort());
    const winner = results[0].status === "success" ? first : second;
    expect(await landlordOf(property.id)).toBe(winner.id);
  });

  it("renters and signed-out visitors can't claim; someone with both roles can", async () => {
    const renter = await createUser({ roles: "renter" });
    const both = await createUser({ roles: "both" });
    const property = await insertProperty({ landlordId: null, createdById: renter.id });
    expect(await landlordAction("claim", property.id)).toEqual({ status: "error", message: LOG_IN_AGAIN });
    await logInAs(renter);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "error", message: ONLY_LANDLORDS_CLAIM });
    expect(await landlordOf(property.id)).toBeNull();
    await logInAs(both);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(property.id)).toBe(both.id);
  });

  it("rejects a missing or malformed property id, and an unknown intent", async () => {
    await logInAs(await createUser({ roles: "landlord" }));
    const doesNotExist = { status: "error", message: MISSING };
    expect(await landlordAction("claim", undefined)).toEqual(doesNotExist);
    expect(await landlordAction("claim", "not-a-uuid")).toEqual(doesNotExist);
    expect(await landlordAction("claim", randomUUID())).toEqual(doesNotExist);
    const property = await insertProperty({ landlordId: null, createdById: null });
    expect(await landlordAction("take", property.id)).toEqual({
      status: "error",
      message: "Something went wrong. Reload the page and try again.",
    });
    expect(await landlordOf(property.id)).toBeNull();
  });

  it("is refused for a property you reviewed; the review and the listing stay as they were", async () => {
    const user = await createUser({ roles: "both" });
    const property = await insertProperty({ landlordId: null, createdById: user.id });
    const reviewId = await insertReview({ kind: "property", authorId: user.id, propertyId: property.id });
    await logInAs(user);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "error", message: CLAIM_AFTER_REVIEW });
    expect(await landlordOf(property.id)).toBeNull();
    // A refused claim still refreshes the page.
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${property.id}`);
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, property.id))).toEqual([
      { id: reviewId },
    ]);
    // Once the review is gone, the claim works.
    await db.delete(reviews).where(eq(reviews.id, reviewId));
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
  });

  it("other people's reviews don't stop a claim, nor do your reviews of other places", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "both" });
    const property = await insertProperty({ landlordId: null, createdById: renter.id });
    await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id });
    const elsewhere = await insertProperty({ landlordId: null, createdById: null });
    await insertReview({ kind: "property", authorId: landlord.id, propertyId: elsewhere.id });
    await logInAs(landlord);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
  });

  it("claiming one you already manage just says it's yours", async () => {
    const user = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: user.id, createdById: user.id });
    await logInAs(user);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
  });
});

// ---------------------------------------------------------------------------
// Unlink: "Not my property"
// ---------------------------------------------------------------------------

describe("unlink (“Not my property”)", () => {
  it("lets the linked landlord remove themselves; the listing and its reviews stay", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    const reviewId = await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id });
    await logInAs(landlord);
    expect(await landlordAction("unlink", property.id)).toEqual({ status: "success", message: UNLINKED });
    expect(await propertyRow(property.id)).toMatchObject({ landlordId: null, createdById: renter.id });
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, property.id))).toEqual([
      { id: reviewId },
    ]);
    // Their account keeps the landlord role.
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${property.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${landlord.id}`);
  });

  it("works for an account a renter linked by kennitala", async () => {
    const landlord = await createUser({ roles: "renter" });
    await logInAs(await createUser({ roles: "renter" }));
    const id = addedId(await add({ landlordKennitala: landlord.kennitala }));
    await logInAs(landlord);
    expect(await landlordAction("unlink", id)).toEqual({ status: "success", message: UNLINKED });
    expect(await landlordOf(id)).toBeNull();
  });

  it("can't unlink someone else's property", async () => {
    const owner = await createUser({ roles: "landlord" });
    const other = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: owner.id, createdById: renter.id });
    await logInAs(other);
    expect(await landlordAction("unlink", property.id)).toEqual({ status: "error", message: NOT_LISTED });
    // Not even the renter who added it.
    await logInAs(renter);
    expect(await landlordAction("unlink", property.id)).toEqual({ status: "error", message: NOT_LISTED });
    // Nor a signed-out visitor.
    newVisitor();
    expect(await landlordAction("unlink", property.id)).toEqual({ status: "error", message: LOG_IN_AGAIN });
    expect(await landlordOf(property.id)).toBe(owner.id);
  });

  it("unlinking twice: the second time says you aren't listed", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: landlord.id, createdById: landlord.id });
    await logInAs(landlord);
    expect((await landlordAction("unlink", property.id)).message).toBe(UNLINKED);
    expect(await landlordAction("unlink", property.id)).toEqual({ status: "error", message: NOT_LISTED });
  });

  it("rejects a missing or malformed property id", async () => {
    await logInAs(await createUser({ roles: "landlord" }));
    const doesNotExist = { status: "error", message: MISSING };
    expect(await landlordAction("unlink", undefined)).toEqual(doesNotExist);
    expect(await landlordAction("unlink", "not-a-uuid")).toEqual(doesNotExist);
  });

  it("after unlinking, another landlord can claim it", async () => {
    const wrong = await createUser({ roles: "landlord" });
    const right = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: wrong.id, createdById: null });
    await logInAs(wrong);
    await landlordAction("unlink", property.id);
    await logInAs(right);
    expect(await landlordAction("claim", property.id)).toEqual({ status: "success", message: CLAIMED });
    expect(await landlordOf(property.id)).toBe(right.id);
  });
});

// ---------------------------------------------------------------------------
// Relink: the creator changes the landlord
// ---------------------------------------------------------------------------

describe("relink (the creator changes the landlord)", () => {
  /** A renter's property linked to a landlord profile without an account (with no reviews). */
  async function linkedToProfile(roles: "landlord" | "both" = "landlord") {
    const renter = await createUser({ roles: "renter" });
    const profile = await createUser({ roles, account: false });
    const property = await insertProperty({ landlordId: profile.id, createdById: renter.id });
    await logInAs(renter);
    return { renter, profile, property };
  }

  it("links a new kennitala; the old profile, now referred to by nothing, is deleted", async () => {
    const { profile, property } = await linkedToProfile();
    const kennitala = freshKennitala();
    expect(await relink(property.id, kennitala)).toMatchObject({
      status: "error",
      fieldErrors: { landlordName: [NAME_REQUIRED] },
      landlord: { found: false, birthDate: born(kennitala) },
    });
    expect(
      await landlordAction("relink", property.id, { landlordKennitala: kennitala, landlordName: "Rétti Leigusalinn" }),
    ).toMatchObject({ fieldErrors: { confirmNewLandlord: [CONFIRM_REQUIRED] } });
    expect(await landlordOf(property.id)).toBe(profile.id);

    expect(await relink(property.id, kennitala, "Rétti Leigusalinn")).toEqual({ status: "success", message: RELINKED });
    const [newId] = await idsWithKennitala(kennitala);
    expect(await landlordOf(property.id)).toBe(newId);
    expect(await userRow(newId)).toMatchObject({ name: "Rétti Leigusalinn", isLandlord: true, email: null });
    expect(await userRow(profile.id)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/properties/${property.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${profile.id}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/landlords/${newId}`);
  });

  it("an old profile reviewed as a landlord keeps its page and role", async () => {
    const { renter, profile, property } = await linkedToProfile();
    await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: profile.id });
    const landlord = await createUser({ roles: "landlord" });
    expect(await relink(property.id, landlord.kennitala)).toEqual({ status: "success", message: RELINKED });
    expect(await landlordOf(property.id)).toBe(landlord.id);
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true });
  });

  it("an old profile reviewed only as a renter loses the landlord role", async () => {
    const { profile, property } = await linkedToProfile("both");
    const reviewer = await createUser({ roles: "landlord" });
    await insertReview({ kind: "renter", authorId: reviewer.id, subjectUserId: profile.id });
    expect(await relink(property.id, "")).toEqual({ status: "success", message: RELINK_CLEARED });
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: false, isRenter: true });
  });

  it("an old profile still linked to another property stays a landlord", async () => {
    const { renter, profile, property } = await linkedToProfile();
    const other = await insertProperty({ landlordId: profile.id, createdById: renter.id });
    expect(await relink(property.id, "")).toEqual({ status: "success", message: RELINK_CLEARED });
    expect(await landlordOf(property.id)).toBeNull();
    expect(await landlordOf(other.id)).toBe(profile.id);
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true });
  });

  it("an empty kennitala removes the link; the listing and its reviews stay", async () => {
    const { renter, profile, property } = await linkedToProfile();
    const reviewId = await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id });
    expect(await relink(property.id, " ")).toEqual({ status: "success", message: RELINK_CLEARED });
    expect(await propertyRow(property.id)).toMatchObject({ landlordId: null, createdById: renter.id });
    expect(await userRow(profile.id)).toBeNull();
    const db = await getDb();
    expect(await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.propertyId, property.id))).toEqual([
      { id: reviewId },
    ]);
  });

  it("the same kennitala again changes nothing", async () => {
    const { profile, property } = await linkedToProfile();
    expect(await relink(property.id, profile.kennitala)).toEqual({ status: "success", message: RELINKED });
    expect(await landlordOf(property.id)).toBe(profile.id);
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: true });
  });

  it("links a landlord to a property that has none, giving an account the role; then it's theirs to unlink", async () => {
    const renter = await createUser({ roles: "renter" });
    const other = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: null, createdById: renter.id });
    await logInAs(renter);
    expect(await relink(property.id, other.kennitala)).toEqual({ status: "success", message: RELINKED });
    expect(await landlordOf(property.id)).toBe(other.id);
    expect(await userRow(other.id)).toMatchObject({ isLandlord: true, isRenter: true });
    // Now the landlord has an account: only they can change it.
    expect(await relink(property.id, "")).toEqual({ status: "error", message: HAS_ACCOUNT });
    expect(await landlordOf(property.id)).toBe(other.id);
  });

  it("“check” looks the kennitala up for the creator", async () => {
    const { property } = await linkedToProfile();
    const landlord = await createUser({ roles: "landlord", name: "Jóna Prófunardóttir" });
    expect(await landlordAction("check", property.id, { landlordKennitala: landlord.kennitala })).toMatchObject({
      status: "idle",
      landlord: { found: true, name: "Jóna Prófunardóttir" },
    });
    expect(await landlordOf(property.id)).not.toBe(landlord.id);
  });

  it("others can't relink or look anything up through it", async () => {
    const { profile, property } = await linkedToProfile();
    const landlord = await createUser({ roles: "landlord" });
    for (const other of [await createUser({ roles: "renter" }), landlord]) {
      await logInAs(other);
      expect(await relink(property.id, "")).toEqual({ status: "error", message: NOT_CREATOR });
      expect(await relink(property.id, freshKennitala(), "Einhver Annar")).toEqual({
        status: "error",
        message: NOT_CREATOR,
      });
      expect(await landlordAction("check", property.id, { landlordKennitala: landlord.kennitala })).toEqual({
        status: "error",
        message: NOT_CREATOR,
      });
      expect(await checksBy(other)).toBe(0);
    }
    newVisitor();
    expect(await relink(property.id, "")).toEqual({ status: "error", message: LOG_IN_AGAIN });
    expect(await landlordOf(property.id)).toBe(profile.id);
  });

  it("is refused once the landlord has an account", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: landlord.id, createdById: renter.id });
    await logInAs(renter);
    expect(await relink(property.id, "")).toEqual({ status: "error", message: HAS_ACCOUNT });
    expect(await landlordAction("check", property.id, { landlordKennitala: freshKennitala() })).toEqual({
      status: "error",
      message: HAS_ACCOUNT,
    });
    expect(await landlordOf(property.id)).toBe(landlord.id);

    // A profile that someone takes over by signing up is theirs from then on.
    const { profile, property: linked } = await linkedToProfile();
    await takeOver(profile);
    expect(await relink(linked.id, "")).toEqual({ status: "error", message: HAS_ACCOUNT });
    expect(await landlordOf(linked.id)).toBe(profile.id);
  });

  it("refuses your own kennitala and a minor's, and a property that doesn't exist", async () => {
    const { renter, profile, property } = await linkedToProfile();
    expect(await relink(property.id, renter.kennitala)).toMatchObject({
      fieldErrors: { landlordKennitala: [OWN_KENNITALA] },
    });
    expect(await relink(property.id, freshKennitala("minor"), "Barn Prófun")).toMatchObject({
      fieldErrors: { landlordKennitala: [MINOR] },
    });
    expect(await landlordOf(property.id)).toBe(profile.id);
    expect(await relink(randomUUID(), "")).toEqual({ status: "error", message: MISSING });
  });
});

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

describe("in Icelandic (the default language)", () => {
  it("answers in Icelandic without a language cookie", async () => {
    inIcelandic();
    expect(await add()).toEqual({ status: "error", message: "Skráðu þig inn til að skrá eign." });

    const renter = await createUser({ roles: "renter" });
    await logInAs(renter);
    inIcelandic();
    expect(await add({ address: "", postalCode: "121" })).toMatchObject({
      status: "error",
      message: "Lagaðu merktu reitina.",
      fieldErrors: { address: ["Sláðu inn heimilisfang."], postalCode: ["Veldu póstnúmer af listanum."] },
    });
    const existing = await insertProperty({ landlordId: null, createdById: null });
    expect(await add({ address: existing.address })).toMatchObject({
      message: "Þessi eign er þegar á GossipRent.",
      link: { label: "Fara á eignina" },
    });
    expect(await add({ landlordKennitala: renter.kennitala })).toMatchObject({
      fieldErrors: {
        landlordKennitala: ["Þetta er þín eigin kennitala. Þú getur ekki verið leigusali eignar sem þú leigir."],
      },
    });
    const kennitala = freshKennitala();
    expect(await add({ landlordKennitala: kennitala })).toMatchObject({
      fieldErrors: { landlordName: ["Þessi kennitala er ekki enn á GossipRent. Sláðu inn nafn leigusalans."] },
      landlord: { found: false, birthDate: born(kennitala, "is") },
    });

    const landlord = await createUser({ roles: "landlord" });
    await logInAs(landlord);
    inIcelandic();
    const property = await insertProperty({ landlordId: null, createdById: null });
    expect(await landlordAction("claim", property.id)).toEqual({
      status: "success",
      message: "Komið. Eignin er nú tengd við þig sem leigusala.",
    });
    expect(await landlordAction("unlink", existing.id)).toEqual({
      status: "error",
      message: "Eignin er ekki tengd við þig sem leigusala.",
    });
  });
});

// ---------------------------------------------------------------------------
// At the same moment (real Postgres only)
// ---------------------------------------------------------------------------

/** Properties whose landlord isn't (any more) a landlord (should never exist). */
async function propertiesOfNonLandlord(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .innerJoin(users, eq(users.id, properties.landlordId))
    .where(and(eq(properties.landlordId, userId), eq(users.isLandlord, false)));
  return rows.map((row) => row.id);
}

/** Reviews someone wrote of a property they're now the landlord of (should never exist). */
async function reviewsOfOwnProperties(userId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: reviews.id })
    .from(reviews)
    .innerJoin(properties, eq(properties.id, reviews.propertyId))
    .where(and(eq(reviews.authorId, userId), eq(properties.landlordId, userId)));
  return rows.map((row) => row.id);
}

function removeLandlordRole(): Promise<FormState> {
  return changeRole(idleFormState, form({ role: "landlord", change: "remove" }));
}

describe.runIf(usingPostgres)("at the same moment", () => {
  it("two people adding the same address: one property, and the other is told it's listed", async () => {
    const asA = await logInAs(await createUser({ roles: "renter" }));
    const asB = await logInAs(await createUser({ roles: "renter" }));
    for (let i = 0; i < 8; i++) {
      const token = unique();
      const address = `Samtímagata ${token}`;
      const results = await atOnce(
        () => asVisitor(asA, () => add({ address })),
        () => asVisitor(asB, () => add({ address: address.toUpperCase() })),
        i,
      );
      const detail = `run ${i}: ${JSON.stringify(results)}`;
      expect(results.filter((r) => "redirect" in r), detail).toHaveLength(1);
      expect(results.find((r) => !("redirect" in r)), detail).toMatchObject({ message: ALREADY_LISTED });
      const db = await getDb();
      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.addressSearch, `samtimagata ${token}`));
      expect(rows, detail).toHaveLength(1);
    }
  }, 60_000);

  it("two renters linking the same new kennitala: one profile, linked to both places", async () => {
    const asA = await logInAs(await createUser({ roles: "renter" }));
    const asB = await logInAs(await createUser({ roles: "renter" }));
    for (let i = 0; i < 6; i++) {
      const kennitala = freshKennitala();
      const [a, b] = await atOnce(
        () =>
          asVisitor(asA, () =>
            add({ landlordKennitala: kennitala, landlordName: "Fyrra Nafn", confirmNewLandlord: "on" }),
          ),
        () =>
          asVisitor(asB, () =>
            add({ landlordKennitala: kennitala, landlordName: "Seinna Nafn", confirmNewLandlord: "on" }),
          ),
        i,
      );
      const ids = await idsWithKennitala(kennitala);
      expect(ids, `run ${i}`).toHaveLength(1);
      expect(await landlordOf(addedId(a))).toBe(ids[0]);
      expect(await landlordOf(addedId(b))).toBe(ids[0]);
    }
  }, 60_000);

  it("adding your own property while removing the landlord role never leaves you managing it", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser({ roles: "both" });
      const visitor = await logInAs(user);
      const [removed, added] = await atOnce(
        () => asVisitor(visitor, removeLandlordRole),
        () => asVisitor(visitor, () => add({ relation: "own" })),
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; add → ${JSON.stringify(added)}`;
      expect(removed.status, detail).toBe("success");
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
      if (!("redirect" in added)) {
        expect(added, detail).toMatchObject({ status: "error", message: ONLY_LANDLORDS_OWN });
      }
    }
  }, 60_000);

  it("a renter linking you as their landlord while you remove that role never leaves a non-landlord linked", async () => {
    for (let i = 0; i < 12; i++) {
      const user = await createUser({ roles: "both" });
      const asUser = await logInAs(user);
      const asRenter = await logInAs(await createUser({ roles: "renter" }));
      const [removed, added] = await atOnce(
        () => asVisitor(asUser, removeLandlordRole),
        () => asVisitor(asRenter, () => add({ landlordKennitala: user.kennitala })),
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; add → ${JSON.stringify(added)}`;
      expect(removed.status, detail).toBe("success");
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
      // The link always lands: either after the removal (giving the role back) or before it (then unlinked).
      expect("redirect" in added, detail).toBe(true);
    }
  }, 60_000);

  it("a claim racing the landlord role's removal never leaves a non-landlord managing a property", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser({ roles: "both" });
      const property = await insertProperty({ landlordId: null, createdById: null });
      const visitor = await logInAs(user);
      const [removed, claimed] = await atOnce(
        () => asVisitor(visitor, removeLandlordRole),
        () => asVisitor(visitor, () => landlordAction("claim", property.id)),
        i,
      );
      const detail = `run ${i}: remove → ${removed.message}; claim → ${claimed.message}`;
      expect(await propertiesOfNonLandlord(user.id), detail).toEqual([]);
      expect(removed.status, detail).toBe("success");
      // The claim either landed first (and was unlinked by the removal) or was refused.
      expect(await landlordOf(property.id), detail).toBeNull();
    }
  }, 60_000);

  it("a claim and a review of the same place at the same moment never both land", async () => {
    for (let i = 0; i < 10; i++) {
      const user = await createUser({ roles: "both" });
      const property = await insertProperty({ landlordId: null, createdById: null });
      const visitor = await logInAs(user);
      const [claimed, reviewed] = await atOnce(
        () => asVisitor(visitor, () => landlordAction("claim", property.id)),
        () => asVisitor(visitor, () => reviewProperty(property.id)),
        i,
      );
      const detail = `run ${i}: claim → ${claimed.message}; review → ${reviewed.message}`;
      expect(await reviewsOfOwnProperties(user.id), detail).toEqual([]);
      expect([claimed.status, reviewed.status].sort(), detail).toEqual(["error", "success"]);
      if (claimed.status === "error") expect(claimed.message, detail).toBe(CLAIM_AFTER_REVIEW);
    }
  }, 60_000);

  it("relinking while the old landlord signs up never moves the property away from an account", async () => {
    for (let i = 0; i < 10; i++) {
      const renter = await createUser({ roles: "renter" });
      const profile = await createUser({ roles: "landlord", account: false });
      const property = await insertProperty({ landlordId: profile.id, createdById: renter.id });
      const asRenter = await logInAs(renter);
      const db = await getDb();
      const [relinked] = await atOnce(
        () => asVisitor(asRenter, () => relink(property.id, "")),
        () =>
          db
            .update(users)
            .set({ email: `signup-${unique()}@example.com`, passwordHash: "not-a-real-hash", joinedAt: new Date() })
            .where(and(eq(users.id, profile.id), isNull(users.email))),
        i,
      );
      const detail = `run ${i}: relink → ${relinked.message}`;
      const row = await userRow(profile.id);
      if (relinked.status === "success") {
        expect(await landlordOf(property.id), detail).toBeNull();
      } else {
        expect(relinked.message, detail).toBe(HAS_ACCOUNT);
        expect(await landlordOf(property.id), detail).toBe(profile.id);
        expect(row?.passwordHash, detail).not.toBeNull();
      }
    }
  }, 60_000);
});
