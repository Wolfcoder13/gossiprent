/**
 * The operator commands (scripts/admin-commands.ts, run by `npm run admin`)
 * against a real database: what each one changes and prints, that nothing
 * people typed reaches the terminal as control characters or a kennitala, and
 * that resetting an account tidies up like closing one does.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { properties, propertyDisclaimers, reports, reviews, sessions, users } from "@/db/schema";
import { formatKennitala } from "@/lib/kennitala";
import {
  forTerminal,
  InputError,
  maskKennitalas,
  parseCommand,
  run,
  UsageError,
} from "../../scripts/admin-commands";
import {
  createUser,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  unique,
  userRow,
  usingPostgres,
} from "./support/harness";

const ESC = "\x1b";
const BEL = "\x07";
const RLO = String.fromCharCode(0x202e);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const EN_DASH = String.fromCharCode(0x2013);
const MISSING = "00000000-0000-0000-0000-000000000000";

/** Run a command line, returning what it printed. */
async function admin(...args: string[]): Promise<string> {
  const lines: string[] = [];
  await run(await getDb(), args, (line) => lines.push(line));
  return lines.join("\n");
}

async function landlordOf(propertyId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ landlordId: properties.landlordId, landlordConfirmed: properties.landlordConfirmed })
    .from(properties)
    .where(eq(properties.id, propertyId));
  return row;
}

async function reviewExists(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, id))).length > 0;
}

/** Control characters, bidi controls and line separators: none may reach the terminal raw. */
const UNSAFE = new RegExp(`[\\x00-\\x09\\x0b-\\x1f\\x7f-\\x9f${RLO}${LINE_SEPARATOR}]`);

describe("forTerminal", () => {
  it("shows control characters as their code, keeping line breaks (CRLF and CR become \\n)", () => {
    expect(forTerminal(`a${ESC}[2Jb`)).toBe("a\\u{1b}[2Jb");
    expect(forTerminal(`${ESC}]52;c;ZWNobyBoaQ==${BEL}`)).toBe("\\u{1b}]52;c;ZWNobyBoaQ==\\u{7}");
    expect(forTerminal("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
    expect(forTerminal(`tab\there`)).toBe("tab\\u{9}here");
    expect(forTerminal(`${RLO}gpj.exe`)).toBe("\\u{202e}gpj.exe");
    expect(forTerminal(`a${LINE_SEPARATOR}b`)).toBe("a\\u{2028}b");
    expect(forTerminal(`c1${String.fromCharCode(0x9b)}31m`)).toBe("c1\\u{9b}31m");
  });

  it("leaves ordinary text, Icelandic letters and punctuation alone", () => {
    const text = "Þórdís Ævarsdóttir – „Íbúðin“ var fín: 4,5 af 5! (t.d.)";
    expect(forTerminal(text)).toBe(text);
  });
});

describe("maskKennitalas", () => {
  it("masks every way of writing a kennitala the app accepts", () => {
    const kennitala = "1503853579";
    for (const written of [
      "1503853579",
      "150385-3579",
      "150385 3579",
      "150385 - 3579",
      "150385 -3579",
      "150385  3579",
      `150385${EN_DASH}3579`,
      `150385 ${EN_DASH} 3579`,
    ]) {
      const masked = maskKennitalas(`kt. ${written}, takk`);
      expect(masked, written).toBe("kt. [kennitala], takk");
      expect(masked).not.toContain(kennitala.slice(0, 6));
    }
  });
});

describe("parseCommand", () => {
  it("checks the command line without a database", () => {
    expect(() => parseCommand([])).toThrow(UsageError);
    expect(() => parseCommand(["nope"])).toThrow("Unknown command: nope");
    expect(() => parseCommand(["remove-review", "not-a-uuid"])).toThrow("Give the review id (a UUID).");
    expect(() => parseCommand(["relink-property", MISSING])).toThrow("Give the landlord's kennitala, or none.");
    expect(typeof parseCommand(["reports"])).toBe("function");
  });
});

describe("reports", () => {
  it("prints report details, names and emails safely, with kennitalas masked", async () => {
    const db = await getDb();
    const marker = unique();
    const [report] = await db
      .insert(reports)
      .values({
        targetKind: "account",
        reason: "identity_claimed",
        details: `Someone ${marker} used 150385 - 3579\r\nsecond line${ESC}[2J${ESC}[3J${ESC}[H\rFrom:    fake${ESC}]52;c;cm0gLXJmIH4=${BEL}`,
        contactEmail: `x${ESC}[8m@example.com`,
      })
      .returning({ id: reports.id });
    try {
      const printed = await admin("reports");
      const block = printed.slice(printed.indexOf(`Report ${report.id}`));
      expect(block).toContain(`Someone ${marker} used [kennitala]\n           second line\\u{1b}[2J`);
      expect(block).toContain("\\u{1b}[H\n           From:    fake\\u{1b}]52;c;cm0gLXJmIH4=\\u{7}");
      expect(block).toContain("<x\\u{1b}[8m@example.com>");
      expect(printed).not.toMatch(UNSAFE);
      expect(printed).not.toContain("3579");
    } finally {
      await db.delete(reports).where(eq(reports.id, report.id));
    }
  });
});

describe("resolve", () => {
  it("marks a report resolved, and needs a note and a known id", async () => {
    const db = await getDb();
    const [report] = await db
      .insert(reports)
      .values({ targetKind: "review", reason: "other", details: "Details long enough." })
      .returning({ id: reports.id });
    await expect(admin("resolve", report.id)).rejects.toThrow(InputError);
    await expect(admin("resolve", MISSING, "done")).rejects.toThrow("No report with that id.");
    expect(await admin("resolve", report.id, "Removed", "the", "review")).toBe("Resolved.");
    const [row] = await db.select().from(reports).where(eq(reports.id, report.id));
    expect(row).toMatchObject({ resolution: "Removed the review", resolvedAt: expect.any(Date) });
  });
});

describe("remove-review", () => {
  it("removes the review, and a profile without an account that only it kept", async () => {
    const author = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "landlord", account: false });
    const reviewId = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: profile.id });
    expect(await admin("remove-review", reviewId)).toBe("Review removed.");
    expect(await reviewExists(reviewId)).toBe(false);
    expect(await userRow(profile.id)).toBeNull();
  });

  it("keeps a profile that is still reviewed, with only the roles it is still reviewed in", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const profile = await createUser({ roles: "both", account: false });
    const asLandlord = await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: profile.id });
    const asRenter = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: profile.id });
    await admin("remove-review", asLandlord);
    expect(await userRow(profile.id)).toMatchObject({ isLandlord: false, isRenter: true });
    expect(await reviewExists(asRenter)).toBe(true);
  });

  it("leaves accounts alone, and refuses an unknown id", async () => {
    const renter = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const reviewId = await insertReview({ kind: "landlord", authorId: renter.id, subjectUserId: landlord.id });
    await admin("remove-review", reviewId);
    expect(await userRow(landlord.id)).toMatchObject({ isLandlord: true, email: landlord.email });
    await expect(admin("remove-review", MISSING)).rejects.toThrow("No review with that id.");
  });

  it.runIf(usingPostgres)("tidies up a profile another transaction had locked, once that one commits", async () => {
    const author = await createUser({ roles: "renter" });
    const profile = await createUser({ roles: "landlord", account: false });
    const reviewId = await insertReview({ kind: "landlord", authorId: author.id, subjectUserId: profile.id });
    const db = await getDb();
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const holding = db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, profile.id)).for("update");
      locked();
      await released;
    });
    await isLocked;

    const removing = admin("remove-review", reviewId);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await reviewExists(reviewId)).toBe(false);
    expect(await userRow(profile.id)).not.toBeNull();
    release();
    await holding;
    expect(await removing).toBe("Review removed.");
    expect(await userRow(profile.id)).toBeNull();
  });
});

describe("reset-account", () => {
  it("removes an account nothing refers to, row and sessions", async () => {
    const user = await createUser({ roles: "both", name: `Óþekkt${ESC}[2J Nafn` });
    const db = await getDb();
    await db.insert(sessions).values({ id: `s-${unique()}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    const printed = await admin("reset-account", user.id);
    expect(printed).toContain("no longer has an account. Nothing referred to them, so the profile was removed too.");
    expect(printed).not.toMatch(UNSAFE);
    expect(await userRow(user.id)).toBeNull();
  });

  it("keeps someone reviewed as a renter, as a renter only, with the reviews about them untouched", async () => {
    const user = await createUser({ roles: "both", city: "Ísafjörður" });
    const landlord = await createUser({ roles: "landlord" });
    const about = await insertReview({ kind: "renter", authorId: landlord.id, subjectUserId: user.id });
    const db = await getDb();
    await db.update(users).set({ bio: "Um mig" }).where(eq(users.id, user.id));
    await db.insert(sessions).values({ id: `s-${unique()}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });

    expect(await admin("reset-account", user.id)).toBe(
      `${user.name} no longer has an account; the profile and reviews about them stay.`,
    );
    expect(await userRow(user.id)).toMatchObject({
      email: null,
      passwordHash: null,
      joinedAt: null,
      city: null,
      bio: null,
      isLandlord: false,
      isRenter: true,
      name: user.name,
    });
    expect(await reviewExists(about)).toBe(true);
    expect(await db.select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
  });

  it("never removes reviews they wrote, and says how many there are", async () => {
    const user = await createUser({ roles: "renter" });
    const landlord = await createUser({ roles: "landlord" });
    const written = await insertReview({ kind: "landlord", authorId: user.id, subjectUserId: landlord.id });
    const printed = await admin("reset-account", user.id);
    expect(printed).toContain("no longer has an account; the profile and reviews about them stay.");
    expect(printed).toContain("They wrote 1 review(s), which stay up. Remove any with remove-review <reviewId>.");
    expect(await reviewExists(written)).toBe(true);
    expect(await userRow(user.id)).toMatchObject({ passwordHash: null, isRenter: true });
  });

  it("keeps a property's landlord linked", async () => {
    const user = await createUser({ roles: "both" });
    const renter = await createUser({ roles: "renter" });
    const property = await insertProperty({ landlordId: user.id, createdById: renter.id });
    await admin("reset-account", user.id);
    expect(await userRow(user.id)).toMatchObject({ passwordHash: null, isLandlord: true, isRenter: false });
    expect((await landlordOf(property.id)).landlordId).toBe(user.id);
  });

  it("refuses an unknown id or a profile without an account, changing nothing", async () => {
    await expect(admin("reset-account", MISSING)).rejects.toThrow("No person with that id.");
    const profile = await createUser({ roles: "renter", account: false });
    await expect(admin("reset-account", profile.id)).rejects.toThrow("That person has no account.");
    expect(await userRow(profile.id)).not.toBeNull();
  });
});

describe("rename-profile", () => {
  it("renames, with the sort and search keys", async () => {
    const profile = await createUser({ roles: "renter", account: false });
    expect(await admin("rename-profile", profile.id, "Þórdís", "Jónsdóttir")).toBe("New name: Þórdís Jónsdóttir");
    expect(await userRow(profile.id)).toMatchObject({ name: "Þórdís Jónsdóttir", nameSearch: "thordis jonsdottir" });
  });

  it("refuses a name that is too short, too long or holds a kennitala, and an unknown id", async () => {
    const profile = await createUser({ roles: "renter", account: false });
    await expect(admin("rename-profile", profile.id, "J")).rejects.toThrow("A name is 2–80 characters.");
    await expect(admin("rename-profile", profile.id, "x".repeat(81))).rejects.toThrow("A name is 2–80 characters.");
    await expect(admin("rename-profile", profile.id, "Jón", formatKennitala(freshKennitala()))).rejects.toThrow(
      "A name can't contain a kennitala.",
    );
    await expect(admin("rename-profile", MISSING, "Jón Jónsson")).rejects.toThrow("No person with that id.");
    expect(await userRow(profile.id)).toMatchObject({ name: profile.name });
  });
});

describe("relink-property", () => {
  it("links someone new by kennitala and name, unconfirmed, and tidies up the old landlord", async () => {
    const renter = await createUser({ roles: "renter" });
    const old = await createUser({ roles: "landlord", account: false });
    const property = await insertProperty({ landlordId: old.id, createdById: renter.id });
    const kennitala = freshKennitala();

    const printed = await admin("relink-property", property.id, formatKennitala(kennitala), "Ný", "Leigusali");
    expect(printed).toMatch(/^Landlord is now Ný Leigusali \([0-9a-f-]{36}\)\.$/);
    expect(printed).not.toContain(kennitala.slice(0, 6));
    const link = await landlordOf(property.id);
    expect(await userRow(link.landlordId!)).toMatchObject({ kennitala, name: "Ný Leigusali", isLandlord: true });
    expect(link.landlordConfirmed).toBe(false);
    // Nothing refers to the old landlord any more.
    expect(await userRow(old.id)).toBeNull();
  }, 15_000);

  it("needs a name for a kennitala nobody has, and refuses a minor's or an invalid one", async () => {
    const property = await insertProperty({ landlordId: null, createdById: null });
    await expect(admin("relink-property", property.id, freshKennitala())).rejects.toThrow(
      "Nobody has that kennitala yet: give their name too.",
    );
    await expect(admin("relink-property", property.id, freshKennitala("minor"), "Barn")).rejects.toThrow(
      "That kennitala belongs to someone under 18.",
    );
    await expect(admin("relink-property", property.id, "123")).rejects.toThrow(
      "That isn't a valid kennitala (or use none).",
    );
    await expect(admin("relink-property", MISSING, "none")).rejects.toThrow("No property with that id.");
  });

  it("links an existing person (giving them the landlord role), and clears the confirmation", async () => {
    const renter = await createUser({ roles: "renter" });
    const confirmed = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: confirmed.id, createdById: confirmed.id, landlordConfirmed: true });

    // The same landlord again: their own confirmation stays.
    await admin("relink-property", property.id, confirmed.kennitala);
    expect(await landlordOf(property.id)).toEqual({ landlordId: confirmed.id, landlordConfirmed: true });

    expect(await admin("relink-property", property.id, renter.kennitala)).toBe(
      `Landlord is now ${renter.name} (${renter.id}).`,
    );
    expect(await landlordOf(property.id)).toEqual({ landlordId: renter.id, landlordConfirmed: false });
    expect(await userRow(renter.id)).toMatchObject({ isLandlord: true, isRenter: true });
    // The account that was the landlord is left alone.
    expect(await userRow(confirmed.id)).toMatchObject({ isLandlord: true, email: confirmed.email });

    expect(await admin("relink-property", property.id, "none")).toBe("Landlord cleared.");
    expect(await landlordOf(property.id)).toEqual({ landlordId: null, landlordConfirmed: false });
  });

  it("refuses someone who reviewed the property, or said it isn't theirs, changing nothing", async () => {
    const renter = await createUser({ roles: "both" });
    const disclaimer = await createUser({ roles: "landlord" });
    const property = await insertProperty({ landlordId: null, createdById: null });
    await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id });
    const db = await getDb();
    await db.insert(propertyDisclaimers).values({ propertyId: property.id, userId: disclaimer.id });

    await expect(admin("relink-property", property.id, renter.kennitala)).rejects.toThrow(
      "That person has reviewed this property, so they can't be its landlord.",
    );
    await expect(admin("relink-property", property.id, disclaimer.kennitala)).rejects.toThrow(
      "That person has said this isn't their property. Only they can link it again (I manage this property).",
    );
    expect(await landlordOf(property.id)).toEqual({ landlordId: null, landlordConfirmed: false });
  });
});
