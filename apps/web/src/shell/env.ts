import type { AuthServiceContract } from "@tpx/contracts/auth";
import type { ConnectionsServiceContract } from "@tpx/contracts/connections";

/**
 * The bindings tpx-web holds. Service bindings are typed by their contracts;
 * `wrangler types` sees them as plain Fetchers because the services live in
 * other packages.
 */
export interface WebEnv {
  AUTH: Fetcher & AuthServiceContract;
  CONNECTIONS: Fetcher & ConnectionsServiceContract;
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_WEBHOOK_SIGNING_SECRET?: string;
  /** Comma-separated product ids to show as previews (no service yet). */
  TPX_PREVIEW_PRODUCTS?: string;
  /** Development only: a fixture identity instead of Clerk. Dead code in production builds. */
  TPX_DEV_FIXTURE?: string;
}

export function isFixtureMode(env: WebEnv): boolean {
  return import.meta.env.DEV && env.TPX_DEV_FIXTURE === "1";
}

export function previewProducts(env: WebEnv): Set<string> {
  return new Set(
    (env.TPX_PREVIEW_PRODUCTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
