import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Database tests make many round-trips to a remote Postgres while other files run
  // in parallel, so allow more than the 5 s default before calling a test hung.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000,
    // The two-step code path (kept for when the owner switches it back on) is what most auth tests exercise, so
    // they run with it ON. The shipped default is OFF; tests of that set it off explicitly
    // (tests/auth/two-step-setting.test.ts, tests/db/admin-routes.test.ts).
    env: { ADMIN_TWO_STEP: "on" },
  },
});
