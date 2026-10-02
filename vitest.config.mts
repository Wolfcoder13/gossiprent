import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // `server-only` throws when imported outside a React Server Component
      // bundle. Unit tests import server modules directly, so stub it out.
      { find: /^server-only$/, replacement: fromRoot("./tests/unit/stubs/server-only.ts") },
      // Same "@/..." path alias as tsconfig.json.
      { find: /^@\//, replacement: fromRoot("./src/") },
    ],
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
