// Fills an empty database with demo landlords, renters, properties, and reviews.
//
//   npm run db:seed
//
// Uses DATABASE_URL when set, otherwise the built-in local database (stop
// `npm run dev` first — the local database can only be opened by one process).
// Refuses to touch a database that already has users.
import { closeDatabase, connect, getDatabaseMode } from "../src/db/connect";
import { DEMO_PASSWORD } from "../src/db/demo-people";
import { seedDemoData } from "../src/db/seed";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File doesn't exist — that's fine.
  }
}

async function main() {
  const mode = getDatabaseMode();
  // Seed explicitly below rather than via the local database's first-run seeding.
  process.env.SEED_DEMO_DATA = "false";
  const db = await connect();
  try {
    const seeded = await seedDemoData(db);
    if (seeded) {
      console.log(
        `[seed] Added demo data to the ${mode} database. ` +
          `Every demo account uses the password "${DEMO_PASSWORD}" ` +
          "(e.g. sigrun@example.com, kari@example.com).",
      );
    } else {
      console.log("[seed] The database already has users — nothing to do.");
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((error) => {
  console.error("[seed] Failed:", error);
  process.exitCode = 1;
});
