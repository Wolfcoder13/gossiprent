// Operator tools for handling reports and fixing profiles (see docs/iceland-spec.md §10).
//
//   npm run admin -- <command>      (run `npm run admin` for the list of commands)
//
// Uses DATABASE_URL when set, otherwise the built-in local database (stop
// `npm run dev` first). Never prints a kennitala: people are shown by id and name.
// The commands themselves are in admin-commands.ts.
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeDatabase, connect } from "../src/db/connect";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File doesn't exist — that's fine.
  }
}

// src/lib/people.ts is marked `server-only`, which Next resolves to an empty
// module on the server. This script is server code too, so resolve it the same way.
if (typeof registerHooks !== "function") {
  console.error("[admin] Needs Node.js 22.15 or later.");
  process.exit(1);
}
const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const SERVER_ONLY = pathToFileURL(requireFromRoot.resolve("next/dist/compiled/server-only/empty.js")).href;
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === "server-only" ? { url: SERVER_ONLY, shortCircuit: true } : nextResolve(specifier, context),
});

async function main(): Promise<void> {
  // Imported only now: the commands use src/lib/people.ts, which needs the hook above.
  const { forTerminal, InputError, maskKennitalas, parseCommand, USAGE, UsageError } = await import("./admin-commands");
  // Never seed demo data into a database this script opens.
  process.env.SEED_DEMO_DATA = "false";
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    console.log(USAGE);
    return;
  }
  try {
    // A wrong command line fails here, before the database is opened.
    const command = parseCommand(args);
    const db = await connect();
    try {
      await command(db);
    } finally {
      await closeDatabase(db);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
    } else if (error instanceof InputError) {
      console.error(error.message);
    } else {
      // Database errors quote the query's parameters; mask anything kennitala-shaped.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[admin] Failed: ${forTerminal(maskKennitalas(message))}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Only reached if the commands couldn't be loaded; print nothing that could carry data.
  console.error(`[admin] Failed to start: ${error instanceof Error ? error.name : "error"}`);
  process.exitCode = 1;
});
