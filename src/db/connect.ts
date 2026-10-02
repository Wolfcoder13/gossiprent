import fs from "node:fs";
import path from "node:path";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { seedDemoData } from "./seed";

export type Database = NodePgDatabase<typeof schema>;

export type DatabaseMode = "postgres" | "pglite" | "unconfigured";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Connection string for a hosted Postgres (Neon, Supabase, Vercel Postgres…). */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

/**
 * - "postgres":     DATABASE_URL (or POSTGRES_URL) is set — used in production.
 * - "pglite":       no URL and not on Vercel — an embedded Postgres stored in
 *                   ./.data/pglite so `npm run dev` works with zero setup.
 * - "unconfigured": deployed on Vercel without a database. Vercel's filesystem
 *                   is read-only and not shared between instances, so the
 *                   embedded database can't be used there.
 */
export function getDatabaseMode(): DatabaseMode {
  if (getDatabaseUrl()) return "postgres";
  if (process.env.VERCEL) return "unconfigured";
  return "pglite";
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "No database configured. Set DATABASE_URL to a Postgres connection string " +
        "(for example by adding Neon from the Vercel Marketplace) and redeploy.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

export async function connect(): Promise<Database> {
  const mode = getDatabaseMode();
  if (mode === "unconfigured") throw new DatabaseNotConfiguredError();
  if (mode === "postgres") return connectPostgres(getDatabaseUrl()!);
  return connectPglite();
}

/** Close the underlying pool / embedded database (for scripts; the app never closes it). */
export async function closeDatabase(db: Database): Promise<void> {
  const client = (db as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } })
    .$client;
  await (client?.end?.() ?? client?.close?.());
}

function connectPostgres(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idleTimeoutMillis: 10_000,
    // Fail fast (instead of hanging the request) if the database is unreachable.
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection dropped by the server emits "error" on the pool; without
  // a listener that would crash the whole process.
  pool.on("error", (error) => console.error("[db] Idle database connection error:", error));
  // On Vercel Fluid compute this keeps the function alive just long enough to
  // close idle connections cleanly. It's a no-op everywhere else.
  attachDatabasePool(pool);
  return drizzle(pool, { schema });
}

async function connectPglite(): Promise<Database> {
  const dataDir =
    process.env.PGLITE_DATA_DIR || path.join(process.cwd(), ".data", "pglite");
  // The ignore hints stop Next's output tracing from treating this
  // env-dependent path as "could be any file" and bundling the whole project.
  const isFresh = !fs.existsSync(/*turbopackIgnore: true*/ dataDir);
  fs.mkdirSync(/*turbopackIgnore: true*/ dataDir, { recursive: true });

  // Loaded lazily so production deployments never pay for the WASM bundle.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Both drivers expose the same Postgres query builder at runtime.
  const database = db as unknown as Database;
  // Demo data (with its publicly known password) is only added automatically in
  // development. Set SEED_DEMO_DATA=true or false to override.
  const seed = process.env.SEED_DEMO_DATA;
  const shouldSeed = seed ? seed === "true" : process.env.NODE_ENV !== "production";
  if (isFresh && shouldSeed) {
    await seedDemoData(database);
    console.log(
      "[db] Created a local database in %s with demo data " +
        "(set SEED_DEMO_DATA=false to start empty).",
      path.relative(process.cwd(), dataDir) || dataDir,
    );
  }
  return database;
}
