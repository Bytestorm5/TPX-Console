import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end against the real topology in workerd: tpx-web plus both service
 * Workers, in fixture mode (a fixture identity instead of Clerk, in-memory
 * stores instead of Convex). Nothing external is needed.
 */
const port = Number(process.env.TPX_E2E_PORT ?? 5199);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "./test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ignoreHTTPSErrors: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: `TPX_DEV_FIXTURE=1 pnpm exec react-router dev --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
