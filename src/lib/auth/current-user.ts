import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { readSessionUser, type SessionUser } from "./session";

/** The signed-in user, memoized for the duration of one request. */
export const getCurrentUser = cache(readSessionUser);

/** The signed-in user, or a redirect to the login page. */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login");
  }
  return user;
}

export type { SessionUser };
