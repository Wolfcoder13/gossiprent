import "server-only";
import { connect, type Database } from "./connect";

export {
  DatabaseNotConfiguredError,
  getDatabaseMode,
  type Database,
  type Transaction,
} from "./connect";

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
