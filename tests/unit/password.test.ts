import { describe, expect, it } from "vitest";
import {
  hashPassword,
  simulatePasswordCheck,
  verifyPassword,
} from "@/lib/auth/password";

describe("hashPassword", () => {
  it("produces a self-describing scrypt hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    const [scheme, n, r, p, salt, key] = parts;
    expect(scheme).toBe("scrypt");
    expect([n, r, p]).toEqual(["16384", "8", "1"]);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(64);
  });

  it("uses a random salt, so the same password hashes differently each time", async () => {
    const [a, b] = await Promise.all([hashPassword("password123"), hashPassword("password123")]);
    expect(a).not.toBe(b);
    expect(a.split("$")[4]).not.toBe(b.split("$")[4]);
  });

  it("never contains the plaintext password", async () => {
    const hash = await hashPassword("hunter2hunter2");
    expect(hash).not.toContain("hunter2");
  });
});

describe("verifyPassword", () => {
  it("accepts the right password (roundtrip)", async () => {
    const hash = await hashPassword("password123");
    await expect(verifyPassword("password123", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("password123");
    await expect(verifyPassword("password124", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
    await expect(verifyPassword("password123 ", hash)).resolves.toBe(false);
  });

  it("is case-sensitive", async () => {
    const hash = await hashPassword("Password123");
    await expect(verifyPassword("password123", hash)).resolves.toBe(false);
    await expect(verifyPassword("PASSWORD123", hash)).resolves.toBe(false);
  });

  it("handles unicode passwords and normalizes them (NFKC)", async () => {
    // "é" precomposed (U+00E9) vs "e" + combining acute (U+0301).
    const hash = await hashPassword("café-passw0rd");
    await expect(verifyPassword("café-passw0rd", hash)).resolves.toBe(true);
    // The "ﬁ" ligature (U+FB01) is compatibility-equivalent to "fi".
    const ligature = await hashPassword("ﬁne-password");
    await expect(verifyPassword("fine-password", ligature)).resolves.toBe(true);
    await expect(verifyPassword("cafe-passw0rd", hash)).resolves.toBe(false);
  });

  it("verifies hashes made with other scrypt parameters (they're stored in the hash)", async () => {
    // Build a hash with N=1024, r=8, p=1 and a 32-byte key, the same way the module does.
    const { scryptSync } = await import("node:crypto");
    const salt = Buffer.from("0123456789abcdef");
    const key = scryptSync("legacy-password", salt, 32, { N: 1024, r: 8, p: 1 });
    const stored = ["scrypt", 1024, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    await expect(verifyPassword("legacy-password", stored)).resolves.toBe(true);
    await expect(verifyPassword("legacy-passwordX", stored)).resolves.toBe(false);
  });

  it.each([
    ["an empty string", ""],
    ["a plaintext password", "password123"],
    ["a different scheme", "bcrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaA=="],
    ["too few parts", "scrypt$16384$8$1$c2FsdA=="],
    ["too many parts", "scrypt$16384$8$1$c2FsdA==$aGFzaA==$extra"],
    ["an empty key", "scrypt$16384$8$1$c2FsdA==$"],
  ])("returns false for a malformed hash: %s", async (_label, stored) => {
    await expect(verifyPassword("password123", stored)).resolves.toBe(false);
  });

  it("returns false (does not throw) when the stored salt is not valid base64", async () => {
    const real = await hashPassword("password123");
    const parts = real.split("$");
    parts[4] = "!!!not-base64!!!";
    await expect(verifyPassword("password123", parts.join("$"))).resolves.toBe(false);
  });

  // A corrupted or hand-edited row must fail the login, not crash it.
  it("returns false (does not throw) for a hash with invalid scrypt parameters", async () => {
    await expect(
      verifyPassword("password123", "scrypt$abc$8$1$c2FsdA==$aGFzaA=="),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("password123", "scrypt$15$8$1$c2FsdA==$aGFzaA=="),
    ).resolves.toBe(false);
  });

  it("refuses parameters that would make scrypt use unbounded memory", async () => {
    await expect(
      verifyPassword("password123", `scrypt$${2 ** 30}$8$1$c2FsdA==$aGFzaA==`),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("password123", "scrypt$16384$9999$1$c2FsdA==$aGFzaA=="),
    ).resolves.toBe(false);
  });
});

describe("simulatePasswordCheck", () => {
  it("resolves without revealing anything", async () => {
    await expect(simulatePasswordCheck("whatever")).resolves.toBeUndefined();
    // Second call reuses the cached dummy hash.
    await expect(simulatePasswordCheck("another")).resolves.toBeUndefined();
  });
});
