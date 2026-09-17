/**
 * The ancestry seam: environment → project → tenant → *. Only tpx-auth can
 * answer it, because only tpx-auth holds the tenancy tables — which is the
 * architectural reason products attach to it rather than resolving scopes
 * themselves.
 *
 * An id that no longer exists resolves to `["*"]` (rootless) rather than
 * throwing: a stale grant on a deleted project must not brick every request
 * of the user who held it, and a rootless chain fails CLOSED — no tenant
 * grant reaches a scope whose chain does not pass through the tenant.
 */
import type { AncestryResolver } from "@alfiz/core";
import { GLOBAL_SCOPE, parseTpxScope, projectScope, tenantScope } from "@tpx/identity";
import type { TenancyStore } from "./store/types.ts";

export function storeAncestry(tenancy: TenancyStore): AncestryResolver {
  return async (scope) => {
    const parsed = parseTpxScope(scope);
    if (!parsed) throw new Error(`tpx-auth: cannot resolve ancestry of scope ${JSON.stringify(scope)}`);
    switch (parsed.level) {
      case "global":
        return [];
      case "tenant":
        return [GLOBAL_SCOPE];
      case "project": {
        const project = await tenancy.getProjectById(parsed.projectId);
        return project ? [tenantScope(project.tenantId), GLOBAL_SCOPE] : [GLOBAL_SCOPE];
      }
      case "environment": {
        const environment = await tenancy.getEnvironmentById(parsed.environmentId);
        return environment
          ? [projectScope(environment.projectId), tenantScope(environment.tenantId), GLOBAL_SCOPE]
          : [GLOBAL_SCOPE];
      }
    }
  };
}
