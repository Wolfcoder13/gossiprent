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
import {
  clearAttempts,
  clientIp,
  isRateLimited,
  RATE_LIMITS,
  recordAttempt,
} from "@/lib/auth/rate-limit";
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

  const ipKey = `signup:ip:${await clientIp()}`;
  if (await isRateLimited([{ key: ipKey, ...RATE_LIMITS.signupPerIp }])) {
    return tooManyAttempts(formData);
  }
  await recordAttempt([ipKey]);

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

  // Throttle guessing per account and per network, before doing any expensive
  // password hashing.
  const emailKey = `login:email:${email}`;
  const ipKey = `login:ip:${await clientIp()}`;
  const limited = await isRateLimited([
    { key: emailKey, ...RATE_LIMITS.loginPerEmail },
    { key: ipKey, ...RATE_LIMITS.loginPerIp },
  ]);
  if (limited) return tooManyAttempts(formData);

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
    await recordAttempt([emailKey, ipKey]);
    return {
      status: "error",
      message: "That email and password don't match an account.",
      values: formValues(formData),
    };
  }

  await clearAttempts([emailKey]);
  await createSession(user.id);
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}
