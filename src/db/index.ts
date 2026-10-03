import "server-only";
import { connect, type Database } from "./connect";

export { getDatabaseMode, type Transaction } from "./connect";

// Kept on globalThis so dev-mode hot reloads reuse one pool / one embedded
// database instead of opening a new one on every edit.
const globalForDb = globalThis as typeof globalThis & {
  __gossiprentDb?: Promise<Database>;
};

export function getDb(): Promise<Database> {
  globalForDb.__gossiprentDb ??= connect().catch((error: unknown) => {
    globalForDb.__gossiprentDb = undefined;
    throw error;
  });
  return globalForDb.__gossiprentDb;
}

/** Postgres error code, e.g. "23505" for a unique violation. */
export function pgErrorCode(error: unknown): string | undefined {
  // drizzle wraps driver errors; the original is on `cause`.
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres constraint name from a driver error (e.g. "users_email_unique"), if any. */
export function pgConstraint(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === "string") return constraint;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * A replacement for a database error that is safe to log. Drizzle puts the
 * query parameters in its error message, and Postgres puts row values in its
 * DETAIL, so an error from a query carrying a kennitala, email or password
 * hash would leak them into server logs. Keep only the code and constraint.
 */
export function sanitizeDbError(error: unknown): Error & { code?: string; constraint?: string } {
  const code = pgErrorCode(error);
  const constraint = pgConstraint(error);
  // Keep code and constraint as properties so pgErrorCode()/pgConstraint()
  // still recognise e.g. a unique violation after sanitizing. No `cause`.
  return Object.assign(
    new Error(`Database error ${code ?? "unknown"}${constraint ? ` (${constraint})` : ""}`),
    { code, constraint },
  );
}
