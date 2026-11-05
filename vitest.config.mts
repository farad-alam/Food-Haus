import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  // Database tests make many round-trips to a remote Postgres while other files run
  // in parallel, so allow more than the 5 s default before calling a test hung.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
