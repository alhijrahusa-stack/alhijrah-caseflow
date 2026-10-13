import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  // tests/unit was outside this list, so the suites in it never ran. A test file
  // that is never executed is worse than no test file: it reads as coverage.
  test: { include: ["lib/**/*.test.ts", "components/**/*.test.ts", "tests/unit/**/*.test.ts"], env: { TZ: "UTC" } },
});
