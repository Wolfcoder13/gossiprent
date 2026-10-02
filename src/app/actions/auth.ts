"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, pgErrorCode } from "@/db";
import { users } from "@/db/schema";
import {
  hashPassword,
  simulatePasswordCheck,
  verifyPassword,
} from "@/lib/auth/password";
import { createSession, deleteSession } from "@/lib/auth/session";
import {
  formValues,
  loginSchema,
  parseForm,
  safeRedirectPath,
  signupSchema,
  type FormState,
} from "@/lib/validation";

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = parseForm(signupSchema, formData);
  if (!parsed.success) return parsed.state;
  const { name, email, password, role, city } = parsed.data;

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

  const db = await getDb();
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
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

  await createSession(user.id);
  redirect(safeRedirectPath(formData.get("next"), "/dashboard"));
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/");
}
