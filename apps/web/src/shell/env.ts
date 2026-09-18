import type { AuthEnv } from "@tpx/auth-service";
import type { ConnectionsEnv } from "@tpx/connections-service";

/**
 * The Worker's env: the vars and secrets `wrangler.jsonc` declares. Every
 * service reads its own slice (`AuthEnv`, `ConnectionsEnv`) of this one
 * object — one Worker, one env.
 */
export interface WebEnv extends AuthEnv, ConnectionsEnv {
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
