import { defineConfig } from "vitest/config";

/** Pure unit tests (nav builder, scope helpers, forms). The Worker itself is exercised end-to-end by Playwright; each service has its own suite. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
