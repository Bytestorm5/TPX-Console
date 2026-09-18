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
        // The service inside workerd — the runtime it ships in — against the
        // in-memory store. The service is a library with no Worker config of
        // its own, so the runtime is described here; keep it in step with
        // apps/web/wrangler.jsonc.
        plugins: [
          cloudflareTest({ miniflare: { compatibilityDate: "2026-09-01", compatibilityFlags: ["nodejs_compat"] } }),
        ],
        test: {
          name: "workers",
          include: ["test/workers/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
