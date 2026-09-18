/**
 * Router contexts. The Worker entry sets `cloudflareContext` (the env, the
 * execution context and the mounted services); middleware sets the identity,
 * tenant and scope contexts top-down, so every loader below reads a resolved,
 * authorized session instead of re-deriving it.
 */
import { createContext } from "react-router";
import type { Environment, Project, Tenant, TenantSummary } from "@tpx/contracts/auth";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import type { SessionIdentity } from "@tpx/identity";
import type { WebEnv } from "./env.ts";
import type { Services } from "./services.server.ts";

export const cloudflareContext = createContext<{ env: WebEnv; ctx: ExecutionContext; services: Services }>();

export type SignedInIdentity = SessionIdentity & { userId: string };

export const identityContext = createContext<SessionIdentity | null>(null);

export interface TenantSession {
  identity: SignedInIdentity;
  /** Every tenant the user belongs to (never empty: ingress bootstraps one). */
  tenants: TenantSummary[];
  tenant: Tenant;
  tenantCtx: TenantCtx;
}

export interface ScopeSession extends TenantSession {
  project: Project;
  environment: Environment;
  environments: Environment[];
  ctx: Ctx;
}

export const tenantContext = createContext<TenantSession | null>(null);
export const scopeContext = createContext<ScopeSession | null>(null);
