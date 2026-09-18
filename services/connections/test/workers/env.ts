import type { ConnectionsEnv } from "../../src/index.ts";

// Throwaway master keys for tests only (32 random bytes each, base64).
export const TEST_MASTER_KEY = "VGVzdE1hc3RlcktleUZvclRweENvbm5lY3Rpb25zMDE=";
export const TEST_PREVIOUS_KEY = "UHJldmlvdXNNYXN0ZXJLZXlGb3JUcHhDb25uZWN0MDE=";

/** The env the tests construct the service with. Convex is never reached: every test overrides the store. */
export const TEST_ENV: ConnectionsEnv = {
  CONVEX_URL: "https://test.invalid",
  CONVEX_DEPLOY_KEY: "test",
  CONNECTIONS_MASTER_KEY: TEST_MASTER_KEY,
  CONNECTIONS_MASTER_KEY_PREVIOUS: TEST_PREVIOUS_KEY,
};
