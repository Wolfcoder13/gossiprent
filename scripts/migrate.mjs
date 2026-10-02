// Applies the SQL migrations in ./drizzle to the Postgres database named by
// DATABASE_URL. Runs automatically before `next build` (so every Vercel deploy
// keeps the schema up to date) and can be run by hand with `npm run db:migrate`.
//
// With no DATABASE_URL this is a no-op: the built-in local database migrates
// itself the first time the app touches it.
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File doesn't exist — that's fine.
  }
}

// Prefer a direct (non-pooled) connection for schema changes when available.
const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;

if (!url) {
  if (process.env.VERCEL) {
    console.warn(
      "[migrate] DATABASE_URL is not set. The site will deploy, but it needs a " +
        "Postgres database to work: add one (e.g. Neon) from the Storage tab of " +
        "your Vercel project, then redeploy.",
    );
  } else {
    console.log(
      "[migrate] No DATABASE_URL set — skipping. The built-in local database " +
        "is migrated automatically when the app starts.",
    );
  }
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  console.log("[migrate] Database schema is up to date.");
} catch (error) {
  console.error("[migrate] Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
