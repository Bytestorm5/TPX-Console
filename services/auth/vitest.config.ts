import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Convex functions + the Convex store adapter, against convex-test's in-memory backend.
        test: {
          name: "convex",
          include: ["test/convex/**/*.test.ts"],
          environment: "node",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        // The Worker itself, inside workerd, against the in-memory store.
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "workers",
          include: ["test/workers/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
