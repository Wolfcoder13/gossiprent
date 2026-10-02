import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the production build (`npm run build` first),
 * served by `next start` with the built-in embedded database (PGlite) in a
 * brand-new temp folder. Every run therefore starts from the demo data and
 * never touches ./.data or a real DATABASE_URL.
 *
 *   npm run build
 *   npx playwright test
 *
 * Options (environment variables):
 *   E2E_PORT                            port for the test server (default 3210)
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH use a preinstalled Chromium binary
 *   E2E_KEEP_DATA=1                     keep the temp database after the run
 *   E2E_DATABASE_URL                    test against a real Postgres instead of
 *                                       the embedded one. It must be a fresh
 *                                       database with only the demo data:
 *                                       DATABASE_URL=... npm run db:migrate && DATABASE_URL=... npm run db:seed
 */
const port = Number(process.env.E2E_PORT) || 3210;
const baseURL = `http://localhost:${port}`;

// Computed once in the main process and inherited by the worker processes (which
// re-evaluate this file), so everyone agrees on the folder.
process.env.E2E_PGLITE_DATA_DIR ??= path.join(
  os.tmpdir(),
  `gossiprent-e2e-${Date.now()}-${process.pid}`,
);

export default defineConfig({
  testDir: "./tests/e2e",
  // All tests share one server and one embedded database (a single connection),
  // and a few assertions compare site-wide counts, so run them one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Undefined unless set, so Playwright's own browser is used everywhere else.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PGLITE_DATA_DIR: process.env.E2E_PGLITE_DATA_DIR,
      SEED_DEMO_DATA: "true",
      // The suite signs up dozens of accounts from one IP address.
      AUTH_RATE_LIMIT: "off",
      // Never point the tests at the shell's DATABASE_URL; only an explicit
      // E2E_DATABASE_URL switches from the embedded database to Postgres.
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      POSTGRES_URL: "",
      VERCEL: "",
    },
  },
});
