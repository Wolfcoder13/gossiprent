/**
 * The shared unit-test harness works as documented, wired exactly the way
 * other test files wire it, and sessions (src/lib/auth/session.ts) only ever
 * belong to accounts.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", async () => (await import("./next-mocks")).nextHeadersMock);
vi.mock("next/navigation", async () => (await import("./next-mocks")).nextNavigationMock);
vi.mock("next/cache", async () => (await import("./next-mocks")).nextCacheMock);

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientIp } from "@/lib/auth/rate-limit";
import { readSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { isAdultKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { getLocale } from "@/i18n/server";
import {
  asVisitor,
  atOnce,
  createUser,
  currentVisitor,
  form,
  freshKennitala,
  getDb,
  insertProperty,
  insertReview,
  logInAs,
  newVisitor,
  nextCacheMock,
  outcome,
  unique,
  useVisitor,
  userRow,
} from "./harness";

describe("visitors", () => {
  it("start each test with a fresh IP, no session, and English", async () => {
    const visitor = currentVisitor();
    expect(visitor.ip).toMatch(/^2001:db8:/);
    expect([...visitor.cookies]).toEqual([["lang", "en"]]);
    expect(await clientIp()).toBe(visitor.ip);
    expect(await getLocale()).toBe("en");
    expect(await readSessionUser()).toBeNull();
  });

  it("can have no known IP", async () => {
    newVisitor(null);
    expect((await headers()).get("x-real-ip")).toBeNull();
    expect(await clientIp()).toBeNull();
  });

  it("keep their own cookies, also when requests run at the same time", async () => {
    const first = newVisitor();
    const second = newVisitor();
    (await cookies()).set("who", "second");
    useVisitor(first);
    expect((await cookies()).get("who")).toBeUndefined();

    const [a, b] = await atOnce(
      () => asVisitor(first, async () => (await cookies()).get("who")?.value),
      () => asVisitor(second, async () => (await cookies()).get("who")?.value),
    );
    expect([a, b]).toEqual([undefined, "second"]);
  });
});

describe("Next stand-ins", () => {
  it("turn a redirect into an outcome, with its type when one is given", async () => {
    expect(await outcome(Promise.resolve({ status: "idle" }))).toEqual({ status: "idle" });
    expect(await outcome((async () => redirect("/dashboard"))())).toEqual({ redirect: "/dashboard" });
    expect(await outcome((async () => redirect("/?x=1", RedirectType.replace))())).toEqual({
      redirect: "/?x=1",
      type: "replace",
    });
    await expect(outcome(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("record revalidatePath calls, cleared before each test", () => {
    expect(nextCacheMock.revalidatePath).not.toHaveBeenCalled();
    revalidatePath("/landlords");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/landlords");
  });

  it("build form data, leaving out undefined fields", () => {
    const data = form({ kind: "landlord", title: undefined, body: "" });
    expect([...data.entries()]).toEqual([
      ["kind", "landlord"],
      ["body", ""],
    ]);
  });
});

describe("freshKennitala", () => {
  it("gives distinct, valid numbers of the kind asked for", () => {
    const adults = Array.from({ length: 50 }, () => freshKennitala());
    expect(new Set(adults).size).toBe(50);
    for (const value of adults) {
      const parsed = parseKennitalaInput(value)!;
      expect(parsed.type, value).toBe("person");
      expect(isAdultKennitala(parsed), value).toBe(true);
      const year = parsed.birthDate!.getUTCFullYear();
      expect(year >= 1960 && year <= 2000, value).toBe(true);
    }
    const minor = parseKennitalaInput(freshKennitala("minor"))!;
    expect(minor.type === "person" && !isAdultKennitala(minor)).toBe(true);
    expect(parseKennitalaInput(freshKennitala("company"))?.type).toBe("company");
  });
});

describe("rows", () => {
  it("createUser makes accounts and profiles without one", async () => {
    const account = await createUser({ roles: "both", city: "Akureyri" });
    expect(await userRow(account.id)).toMatchObject({
      kennitala: account.kennitala,
      email: account.email,
      isLandlord: true,
      isRenter: true,
      city: "Akureyri",
    });
    expect((await userRow(account.id))!.joinedAt).toBeInstanceOf(Date);

    const profile = await createUser({ roles: "renter", account: false, name: "Jón Jónsson" });
    expect(profile).toMatchObject({ hasAccount: false, email: null, password: null, name: "Jón Jónsson" });
    expect(await userRow(profile.id)).toMatchObject({ passwordHash: null, joinedAt: null, nameSearch: "jon jonsson" });

    const company = await createUser({ roles: "landlord", company: true });
    expect(parseKennitalaInput(company.kennitala)?.type).toBe("company");
    expect((await userRow(company.id))!.isCompany).toBe(true);
  });

  it("insertProperty and insertReview write rows with their derived columns", async () => {
    const landlord = await createUser({ roles: "landlord" });
    const renter = await createUser({ roles: "renter" });
    const address = `Njálsgata ${unique()}`;
    const property = await insertProperty({
      landlordId: landlord.id,
      createdById: renter.id,
      address: ` ${address} `,
      unit: "íbúð 0101",
      postalCode: 101,
    });
    expect(property).toMatchObject({ address, unit: "0101", postalCode: 101 });
    const reviewId = await insertReview({ kind: "property", authorId: renter.id, propertyId: property.id, rating: 5 });
    expect(reviewId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("sessions", () => {
  it("logInAs signs an account in on a new visitor", async () => {
    const user = await createUser({ roles: "landlord", city: "Selfoss" });
    const visitor = await logInAs(user);
    expect(currentVisitor()).toBe(visitor);
    expect(visitor.cookies.get(SESSION_COOKIE)).toBeTruthy();
    expect(visitor.cookies.get("lang")).toBe("en");
    expect(await readSessionUser()).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      isLandlord: true,
      isRenter: false,
      isCompany: false,
      city: "Selfoss",
      bio: null,
    });
    expect(await getCurrentUser()).toMatchObject({ id: user.id });
  });

  it("never carries a kennitala", async () => {
    const user = await createUser({ roles: "renter" });
    await logInAs(user);
    expect(JSON.stringify(await readSessionUser())).not.toContain(user.kennitala);
  });

  it("only belong to accounts: a session for a profile without one (or a closed one) is ignored", async () => {
    const db = await getDb();
    const profile = await createUser({ roles: "renter", account: false });
    await logInAs(profile);
    expect(await readSessionUser()).toBeNull();

    const closing = await createUser({ roles: "renter" });
    await logInAs(closing);
    expect(await readSessionUser()).not.toBeNull();
    await db
      .update(users)
      .set({ email: null, passwordHash: null, joinedAt: null, city: null, bio: null })
      .where(eq(users.id, closing.id));
    expect(await readSessionUser()).toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, closing.id))).toHaveLength(1);
  });
});
