import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// A throwaway master key for tests only (32 zero-free random bytes, base64).
const TEST_MASTER_KEY = "VGVzdE1hc3RlcktleUZvclRweENvbm5lY3Rpb25zMDE=";
const TEST_PREVIOUS_KEY = "UHJldmlvdXNNYXN0ZXJLZXlGb3JUcHhDb25uZWN0MDE=";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "convex",
          include: ["test/convex/**/*.test.ts"],
          environment: "node",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                CONVEX_DEPLOY_KEY: "test",
                CONNECTIONS_MASTER_KEY: TEST_MASTER_KEY,
                CONNECTIONS_MASTER_KEY_PREVIOUS: TEST_PREVIOUS_KEY,
              },
            },
          }),
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
