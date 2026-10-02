"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  simulatePasswordCheck,
  verifyPassword,
} from "@/lib/auth/password";
import { clearAttempts, clientIp, consumeAttempt, RATE_LIMITS } from "@/lib/auth/rate-limit";
import { createSession, deleteSession } from "@/lib/auth/session";
import {
  formValues,
  loginSchema,
  parseForm,
  safeRedirectPath,
  signupSchema,
  type FormState,
} from "@/lib/validation";

const tooManyAttempts = (formData: FormData): FormState => ({
  status: "error",
  message: "Too many attempts. Please wait a few minutes and try again.",
  values: formValues(formData),
});

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(signupSchema, formData);
  if (!parsed.success) return parsed.state;
  const { name, email, password, role, city } = parsed.data;

  const ip = await clientIp();
  const attempt = await consumeAttempt(
    ip ? [{ key: `signup:ip:${ip}`, ...RATE_LIMITS.signupPerIp }] : [],
  );
  if (attempt.limited) return tooManyAttempts(formData);

  const db = await getDb();
  let userId: string;
  try {
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash: await hashPassword(password), role, city })
      .returning({ id: users.id });
    userId = user.id;
  } catch (error) {
    if (pgErrorCode(error) === "23505") {
      return {
        status: "error",
        message: "Please fix the highlighted fields.",
        fieldErrors: {
          email: ["An account with this email already exists. Try logging in instead."],
        },
        values: formValues(formData),
      };
    }
    throw error;
  }

  await createSession(userId);
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(loginSchema, formData);
  if (!parsed.success) return parsed.state;
  const { email, password } = parsed.data;

  // Throttle password guessing before doing any expensive hashing. The strict
  // limit is per account *and* network, so a stranger's failed guesses don't
  // lock the real owner out; a much higher per-account limit and a per-network
  // limit catch guessing spread across many networks or many accounts.
  const ip = await clientIp();
  const accountAndIpKey = `login:account-ip:${email}|${ip ?? "unknown"}`;
  const attempt = await consumeAttempt([
    { key: accountAndIpKey, ...RATE_LIMITS.loginPerAccountAndIp },
    { key: `login:account:${email}`, ...RATE_LIMITS.loginPerAccount },
    ...(ip ? [{ key: `login:ip:${ip}`, ...RATE_LIMITS.loginPerIp }] : []),
  ]);
  if (attempt.limited) return tooManyAttempts(formData);

  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  const valid = user
    ? await verifyPassword(password, user.passwordHash)
    : (await simulatePasswordCheck(password), false);
  if (!user || !valid) {
    return {
      status: "error",
      message: "That email and password don't match an account.",
      values: formValues(formData),
    };
  }

  // A successful login doesn't count, and forgets this network's earlier misses.
  await attempt.release();
  await clearAttempts([accountAndIpKey]);
  await createSession(user.id);
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}
