"use server";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, pgConstraint, pgErrorCode, sanitizeDbError } from "@/db";
import { users } from "@/db/schema";
import { getT, type T } from "@/i18n/server";
import { hashPassword, simulatePasswordCheck, verifyPassword } from "@/lib/auth/password";
import { clearAttempts, clientIp, consumeAttempt, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { createSession, deleteSession } from "@/lib/auth/session";
import { isAdultKennitala, parseKennitalaInput } from "@/lib/kennitala";
import { reportPath } from "@/lib/paths";
import { nameLockedSql, personNameKeys } from "@/lib/people";
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

/** For the derived name columns: keep the stored value once others have described the person by name. */
const keepIfNameLocked = (column: typeof users.name | typeof users.nameSort | typeof users.nameSearch, excluded: string) =>
  sql`case when ${nameLockedSql()} then ${column} else ${sql.raw(`excluded.${excluded}`)} end`;

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
  let account: { id: string; name: string } | undefined;
  try {
    // One statement, so a review being written about this kennitala right now
    // either lands first (and its role is kept) or waits for it.
    [account] = await db
      .insert(users)
      .values({
        kennitala,
        isCompany: false,
        ...keys,
        email,
        passwordHash,
        joinedAt: sql`now()`,
        isLandlord,
        isRenter,
        city,
      })
      .onConflictDoUpdate({
        target: users.kennitala,
        set: {
          email: sql`excluded.email`,
          passwordHash: sql`excluded.password_hash`,
          joinedAt: sql`now()`,
          city: sql`excluded.city`,
          bio: null,
          // The roles they were reviewed or linked in stay; the ticked ones are added.
          isLandlord: sql`${users.isLandlord} or excluded.is_landlord`,
          isRenter: sql`${users.isRenter} or excluded.is_renter`,
          name: keepIfNameLocked(users.name, "name"),
          nameSort: keepIfNameLocked(users.nameSort, "name_sort"),
          nameSearch: keepIfNameLocked(users.nameSearch, "name_search"),
        },
        // Only a profile without an account can be taken over.
        setWhere: isNull(users.email),
      })
      .returning({ id: users.id, name: users.name });
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

  await createSession(account.id);
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

  // A successful login doesn't count, and forgets this network's earlier misses.
  await attempt.release();
  await guarded(() => clearAttempts([accountAndIpKey]));
  await createSession(user.id);
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}
