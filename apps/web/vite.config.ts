import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * Local development runs the one Worker in workerd, exactly as in production:
 * the console and every service in the same isolate. With TPX_DEV_FIXTURE=1
 * the identity is a fixture (no Clerk keys needed) and the services keep
 * their state in memory (no Convex deployment needed) — the fastest way to
 * see the console.
 */
const fixture = process.env.TPX_DEV_FIXTURE === "1";

/**
 * A throwaway master key for fixture mode only: the connections service
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
              vars: {
                ...config.vars,
                TPX_DEV_FIXTURE: "1",
                TPX_PREVIEW_PRODUCTS: "operator,dispatcher,integrator",
                TPX_STORE: "memory",
                CONNECTIONS_MASTER_KEY: FIXTURE_MASTER_KEY,
              },
            }),
          }
        : {}),
    }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: { tsconfigPaths: true },
});
