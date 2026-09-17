import { GLOBAL_SCOPE, parseScopeId, scopeId } from "@alfiz/core";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import { ENVIRONMENT_SCOPE_TYPE, PROJECT_SCOPE_TYPE, TENANT_SCOPE_TYPE } from "./catalog.ts";

export { GLOBAL_SCOPE, userSubject, orgSubject, EVERYONE } from "@alfiz/core";

export const tenantScope = (tenantId: string) => scopeId(TENANT_SCOPE_TYPE, tenantId);
export const projectScope = (projectId: string) => scopeId(PROJECT_SCOPE_TYPE, projectId);
export const environmentScope = (environmentId: string) => scopeId(ENVIRONMENT_SCOPE_TYPE, environmentId);

/** Checks always happen at the innermost scope; grants at any ancestor apply. */
export function scopeForCtx(ctx: Ctx): string {
  return environmentScope(ctx.environmentId);
}

export function scopeForTenantCtx(ctx: TenantCtx): string {
  return tenantScope(ctx.tenantId);
}

export type ParsedTpxScope =
  | { level: "global" }
  | { level: "tenant"; tenantId: string }
  | { level: "project"; projectId: string }
  | { level: "environment"; environmentId: string };

export function parseTpxScope(scope: string): ParsedTpxScope | null {
  if (scope === GLOBAL_SCOPE) return { level: "global" };
  const parsed = parseScopeId(scope);
  if (!parsed) return null;
  switch (parsed.type) {
    case TENANT_SCOPE_TYPE:
      return { level: "tenant", tenantId: parsed.instanceId };
    case PROJECT_SCOPE_TYPE:
      return { level: "project", projectId: parsed.instanceId };
    case ENVIRONMENT_SCOPE_TYPE:
      return { level: "environment", environmentId: parsed.instanceId };
    default:
      return null;
  }
}
