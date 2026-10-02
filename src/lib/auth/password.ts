import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt parameters (OWASP baseline). Stored alongside each hash so they can be
// raised later without invalidating existing passwords.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function deriveKey(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keyLength,
      { N: n, r, p, maxmem: 128 * n * r * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Hash a password as `scrypt$N$r$p$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, N, R, P, KEY_LENGTH);
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** Constant-time check of a password against a stored hash. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nText, rText, pText, saltB64, keyB64] = parts;
  const [n, r, p] = [Number(nText), Number(rText), Number(pText)];
  // A corrupted or hand-edited hash must fail the login, not crash it (and
  // must not make scrypt allocate unbounded memory).
  const validParams =
    Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0 &&
    Number.isInteger(r) && r >= 1 &&
    Number.isInteger(p) && p >= 1 && p <= 16 &&
    128 * n * r <= 64 * 1024 * 1024; // scrypt needs 128·N·r bytes of memory
  const expected = Buffer.from(keyB64, "base64");
  if (!validParams || expected.length === 0 || expected.length > 256) return false;
  try {
    const actual = await deriveKey(
      password,
      Buffer.from(saltB64, "base64"),
      n,
      r,
      p,
      expected.length,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burn the same amount of time as a real password check. Used when a login
 * names an email that doesn't exist, so response timing can't reveal which
 * emails have accounts.
 */
export async function simulatePasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
}
