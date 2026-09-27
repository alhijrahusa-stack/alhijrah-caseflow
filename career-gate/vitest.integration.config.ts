import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs against a real PostgreSQL with both migrations applied (see e2e/run.sh).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { include: ["tests/integration/**/*.int.test.ts"], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
