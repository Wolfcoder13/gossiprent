"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, pgConstraint, pgErrorCode, sanitizeDbError, type Transaction } from "@/db";
import { sessions, users } from "@/db/schema";
import { getT, type T } from "@/i18n/server";
import { hashPassword, simulatePasswordCheck, verifyPassword } from "@/lib/auth/password";
import { clearAttempts, clientIp, consumeAttempt, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { createSession, deleteSession } from "@/lib/auth/session";
import { isAdultKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { reportPath } from "@/lib/paths";
import { isNameLocked, personNameKeys } from "@/lib/people";
import type { FormState } from "@/lib/form-state";
import { formValues, loginSchema, parseForm, safeRedirectPath, signupSchema } from "@/lib/validation";

/**
 * Run a query that sends an email, password hash or kennitala (also inside a
 * rate-limit key), rethrowing a failure without its parameters: Drizzle puts
 * them in its error messages, and those end up in logs.
 */
async function guarded<R>(query: () => Promise<R>): Promise<R> {
  try {
    return await query();
  } catch (error) {
    throw sanitizeDbError(error);
  }
}

function tooManyAttempts(t: T, formData: FormData): FormState {
  return { status: "error", message: t("errors.tooManyAttempts"), values: formValues(formData) };
}

function fieldError(t: T, formData: FormData, field: string, message: string, extra?: Partial<FormState>): FormState {
  return {
    status: "error",
    message: t("validation.fixHighlighted"),
    fieldErrors: { [field]: [message] },
    values: formValues(formData),
    ...extra,
  };
}

// Signup retries when the profile it found was deleted before it could lock it.
const SIGNUP_ATTEMPTS = 3;

type SignupInput = {
  kennitala: string;
  keys: ReturnType<typeof personNameKeys>;
  email: string;
  passwordHash: string;
  isLandlord: boolean;
  isRenter: boolean;
  city: string | null;
};

/**
 * Create the account, or take over the profile without an account that has
 * this kennitala. Null if the kennitala already has an account.
 *
 * In steps rather than one upsert, so the name-lock check sees a review or
 * property link being written about this kennitala right now: those lock the
 * row (or are inserting it), and each step waits for them.
 */
async function createOrTakeOver(tx: Transaction, input: SignupInput): Promise<{ id: string; name: string } | null> {
  const { kennitala, keys, email, passwordHash, isLandlord, isRenter, city } = input;
  for (let attempt = 0; attempt < SIGNUP_ATTEMPTS; attempt++) {
    // 1. A new person. Waits for anyone inserting this kennitala right now.
    const [created] = await guarded(() =>
      tx
        .insert(users)
        .values({ kennitala, isCompany: false, ...keys, email, passwordHash, joinedAt: sql`now()`, isLandlord, isRenter, city })
        .onConflictDoNothing({ target: users.kennitala })
        .returning({ id: users.id, name: users.name }),
    );
    if (created) return created;

    // 2. Someone already has it: lock their row, waiting for a review or
    // property link in progress (their role grant locks it) to commit.
    const [existing] = await guarded(() =>
      tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.kennitala, kennitala))
        .for("update"),
    );
    // Deleted in between (reconcileProfiles): try the insert again.
    if (!existing) continue;
    // Only a profile without an account can be taken over.
    if (existing.email !== null) return null;

    // 3. New statements, so they see everything committed before the lock.
    // Once others have described the person by name, the profile keeps it.
    const locked = await isNameLocked(tx, existing.id);
    const [account] = await guarded(() =>
      tx
        .update(users)
        .set({
          email,
          passwordHash,
          joinedAt: sql`now()`,
          city,
          bio: null,
          // The roles they were reviewed or linked in stay; the ticked ones are added.
          isLandlord: sql`${users.isLandlord} or ${isLandlord}`,
          isRenter: sql`${users.isRenter} or ${isRenter}`,
          ...(locked ? {} : keys),
        })
        .where(eq(users.id, existing.id))
        .returning({ id: users.id, name: users.name }),
    );
    // A profile without an account is never signed in, but a session row can be
    // left on it (e.g. a login that raced an operator reset): delete any, so
    // none comes back to life as this new account.
    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    return account;
  }
  throw new Error("signup: the profile was deleted repeatedly while being taken over");
}

/**
 * Sign up with a kennitala. If someone already reviewed that kennitala (or
 * linked it to a property), the profile they created is taken over: it keeps
 * its reviews, gains the roles ticked here, and keeps the name the reviewers
 * used. A kennitala that already has an account is refused.
 */
export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = parseForm(signupSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const { kennitala, name, email, password, isLandlord, isRenter, city } = parsed.data;

  // The schema only lets through a kennitala that parses.
  const person = parseKennitalaInput(kennitala)!;
  if (person.type === "company") return fieldError(t, formData, "kennitala", t("auth.signup.company"));
  if (!isAdultKennitala(person)) return fieldError(t, formData, "kennitala", t("auth.signup.underage"));

  const ip = await clientIp();
  const attempt = await consumeAttempt(ip ? [{ key: `signup:ip:${ip}`, ...RATE_LIMITS.signupPerIp }] : []);
  if (attempt.limited) return tooManyAttempts(t, formData);

  const passwordHash = await hashPassword(password);
  const keys = personNameKeys(name);
  const db = await getDb();
  let account: { id: string; name: string } | null;
  try {
    account = await db.transaction((tx) =>
      createOrTakeOver(tx, { kennitala, keys, email, passwordHash, isLandlord, isRenter, city }),
    );
  } catch (error) {
    if (pgErrorCode(error) === "23505" && pgConstraint(error) === "users_email_unique") {
      return fieldError(t, formData, "email", t("auth.signup.emailTaken"));
    }
    throw sanitizeDbError(error);
  }
  if (!account) {
    return fieldError(t, formData, "kennitala", t("auth.signup.kennitalaTaken"), {
      link: { href: reportPath("account"), label: t("auth.signup.notYou") },
    });
  }

  // Only if the password is still the one just set (an operator reset can't be undone by a slow request).
  if (!(await createSession(account.id, { expectedHash: passwordHash }))) redirect("/login");
  let next = safeRedirectPath(formData.get("next"), "/dashboard");
  // The dashboard explains why the page kept the reviewers' name.
  if (account.name !== keys.name && next === "/dashboard") next = "/dashboard?name=kept";
  redirect(next);
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const t = await getT();
  const parsed = parseForm(loginSchema, formData, t);
  if (!parsed.success) return parsed.state;
  const { email, password } = parsed.data;

  // Throttle password guessing before doing any expensive hashing. The strict
  // limit is per account *and* network, so a stranger's failed guesses don't
  // lock the real owner out; a much higher per-account limit and a per-network
  // limit catch guessing spread across many networks or many accounts.
  const ip = await clientIp();
  const accountAndIpKey = `login:account-ip:${email}|${ip ?? "unknown"}`;
  const attempt = await guarded(() =>
    consumeAttempt([
      { key: accountAndIpKey, ...RATE_LIMITS.loginPerAccountAndIp },
      { key: `login:account:${email}`, ...RATE_LIMITS.loginPerAccount },
      ...(ip ? [{ key: `login:ip:${ip}`, ...RATE_LIMITS.loginPerIp }] : []),
    ]),
  );
  if (attempt.limited) return tooManyAttempts(t, formData);

  const db = await getDb();
  // Only accounts can log in (a profile without one has no email or password).
  const [user] = await guarded(() =>
    db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.email, email), isNotNull(users.passwordHash)))
      .limit(1),
  );

  const valid = user
    ? await verifyPassword(password, user.passwordHash!)
    : (await simulatePasswordCheck(password), false);
  if (!user || !valid) {
    return { status: "error", message: t("auth.login.noMatch"), values: formValues(formData) };
  }

  // Only while that is still the password: an account closed, reset or given a
  // new password since the check above gets no session.
  if (!(await createSession(user.id, { expectedHash: user.passwordHash! }))) {
    return { status: "error", message: t("auth.login.noMatch"), values: formValues(formData) };
  }
  // A successful login doesn't count, and forgets this network's earlier misses.
  await attempt.release();
  await guarded(() => clearAttempts([accountAndIpKey]));
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}
