import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Remove this run's temporary embedded database (set E2E_KEEP_DATA=1 to keep it). */
export default function globalTeardown() {
  const dir = process.env.E2E_PGLITE_DATA_DIR;
  if (!dir || process.env.E2E_KEEP_DATA) return;
  // Only ever delete the folder this config created inside the temp directory.
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())) return;
  if (!path.basename(resolved).startsWith("gossiprent-e2e-")) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch {
    // Best effort: the OS cleans the temp directory eventually.
  }
}
