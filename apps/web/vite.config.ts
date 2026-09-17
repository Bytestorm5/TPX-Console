import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Local development runs the whole topology in workerd: tpx-web as the entry
 * Worker and every service as an auxiliary Worker reached by service binding,
 * exactly as in production. With TPX_DEV_FIXTURE=1 the identity is a fixture
 * (no Clerk keys needed) and the services keep state in memory (no Convex
 * deployment needed) — the fastest way to see the console.
 */
const fixture = process.env.TPX_DEV_FIXTURE === "1";

/**
 * A throwaway master key for fixture mode only: the connections Worker
 * refuses to start without one, and in fixture mode it encrypts into an
 * in-memory store that dies with the process. Never a real secret.
 */
const FIXTURE_MASTER_KEY = "Zml4dHVyZS1tYXN0ZXIta2V5LWZvci1kZXYtb25seSE=";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      ...(fixture
        ? {
            config: (config) => ({
              vars: { ...config.vars, TPX_DEV_FIXTURE: "1", TPX_PREVIEW_PRODUCTS: "operator,dispatcher,integrator" },
            }),
          }
        : {}),
      auxiliaryWorkers: [
        {
          configPath: "../../services/auth/wrangler.jsonc",
          ...(fixture ? { config: (config) => ({ vars: { ...config.vars, TPX_STORE: "memory" } }) } : {}),
        },
        {
          configPath: "../../services/connections/wrangler.jsonc",
          ...(fixture
            ? {
                config: (config) => ({
                  vars: { ...config.vars, TPX_STORE: "memory", CONNECTIONS_MASTER_KEY: FIXTURE_MASTER_KEY },
                }),
              }
            : {}),
        },
      ],
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: { tsconfigPaths: true },
});
