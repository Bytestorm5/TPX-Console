/**
 * From an identity to an authorized session: the tenant (Clerk organization),
 * the scope resolved from the URL, and the grants the user holds there —
 * computed once per request through the Alfiz client over tpx-auth.
 */
import { clerkClient } from "@clerk/react-router/server";
import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import { data, redirect } from "react-router";
import type { ProductCapabilities } from "@tpx/contracts/product";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import {
  createTpxClient,
  defaultTenantName,
  environmentScope,
  grantsAt,
  hasGrant,
  tenantScope,
  type HasGrants,
  type TpxClient,
  type TpxKey,
} from "@tpx/identity";
import {
  cloudflareContext,
  scopeContext,
  tenantContext,
  type ScopeSession,
  type TenantIdentity,
  type TenantSession,
} from "./context.ts";
import { isFixtureMode, previewProducts, type WebEnv } from "./env.ts";
import { FIXTURE_IDENTITY, requireTenantIdentity } from "./identity.server.ts";
import { rpc } from "./rpc.server.ts";
import { scopePath } from "./scope.ts";
import { products } from "../registry.ts";

const clients = new WeakMap<WebEnv["AUTH"], TpxClient>();

/** One Alfiz client per isolate; closures are cached with epoch revalidation against tpx-auth. */
export function getTpxClient(env: WebEnv): TpxClient {
  let client = clients.get(env.AUTH);
  if (!client) {
    client = createTpxClient({
      getSubjectAccess: (principal) => env.AUTH.getSubjectAccess(principal),
      resolveAncestors: (scope) => env.AUTH.resolveAncestors(scope),
      epochHead: () => env.AUTH.epochHead(),
      epochSince: (seq, limit) => env.AUTH.epochSince(seq, limit),
    });
    clients.set(env.AUTH, client);
  }
  return client;
}

async function organizationName(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
  identity: TenantIdentity,
): Promise<string> {
  const { env } = args.context.get(cloudflareContext);
  if (isFixtureMode(env)) return defaultTenantName(FIXTURE_IDENTITY);
  try {
    const org = await clerkClient(args as LoaderFunctionArgs).organizations.getOrganization({
      organizationId: identity.orgId,
    });
    return org.name;
  } catch {
    return defaultTenantName(identity);
  }
}

/** Ensures the org is a tenant and the user is recorded as a member; returns the tenant-level session. */
export async function resolveTenantSession(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
): Promise<TenantSession> {
  const { env } = args.context.get(cloudflareContext);
  const identity = await requireTenantIdentity(args);
  await rpc(env.AUTH.ensureUser({ userId: identity.userId, orgId: identity.orgId, orgRole: identity.orgRole }));
  const tenant =
    (await rpc(env.AUTH.findTenant(identity.orgId))) ??
    (await rpc(
      env.AUTH.ensureTenant({
        orgId: identity.orgId,
        name: await organizationName(args, identity),
        creatorUserId: identity.userId,
      }),
    ));
  const client = getTpxClient(env);
  const scope = tenantScope(tenant.id);
  const snapshot = await client.snapshot({ userId: identity.userId }, { scopes: [scope] });
  const tenantCtx: TenantCtx = { tenantId: tenant.id, userId: identity.userId, grants: grantsAt(snapshot, scope) };
  return { identity, tenant, tenantCtx };
}

/** Resolves `/:project/:environment` into an authorized scope, or 404 — never revealing whether the project exists. */
export async function resolveScopeSession(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
  projectSlug: string,
  environmentName: string | null,
): Promise<ScopeSession> {
  const { env } = args.context.get(cloudflareContext);
  const session = await resolveTenantSession(args);
  const resolved = await rpc(env.AUTH.resolveScope({ tenantId: session.tenant.id, projectSlug, environmentName }));
  if (!resolved) throw data({ error: "project or environment not found" }, { status: 404 });
  const scope = environmentScope(resolved.environment.id);
  const snapshot = await getTpxClient(env).snapshot({ userId: session.identity.userId }, { scopes: [scope] });
  const grants = grantsAt(snapshot, scope);
  if (!grants.includes("tpx.workspace.projects.read"))
    throw data({ error: "project or environment not found" }, { status: 404 });
  const ctx: Ctx = {
    tenantId: session.tenant.id,
    projectId: resolved.project.id,
    environmentId: resolved.environment.id,
    environmentName: resolved.environment.name,
    userId: session.identity.userId,
    grants,
  };
  return {
    ...session,
    project: resolved.project,
    environment: resolved.environment,
    environments: resolved.environments,
    ctx,
  };
}

export const tenantMiddleware: MiddlewareFunction<Response> = async (args, next) => {
  args.context.set(tenantContext, await resolveTenantSession(args));
  return next();
};

export const scopeMiddleware: MiddlewareFunction<Response> = async (args, next) => {
  const projectSlug = args.params.project;
  const environmentName = args.params.environment ?? null;
  if (!projectSlug) throw data({ error: "missing project" }, { status: 404 });
  const session = await resolveScopeSession(args, projectSlug, environmentName);
  if (environmentName === null) throw redirect(scopePath(session.project.slug, session.environment.name));
  args.context.set(scopeContext, session);
  args.context.set(tenantContext, session);
  return next();
};

export function requireScope(args: Pick<LoaderFunctionArgs, "context">): ScopeSession {
  const session = args.context.get(scopeContext);
  if (!session) throw new Error("scope middleware did not run");
  return session;
}

export function requireTenant(args: Pick<LoaderFunctionArgs, "context">): TenantSession {
  const session = args.context.get(tenantContext);
  if (!session) throw new Error("tenant middleware did not run");
  return session;
}

/** Page-level gate: a loader that needs a grant the user lacks renders the 403 section, not a broken page. */
export function assertGrant(ctx: HasGrants, key: TpxKey): void {
  if (!hasGrant(ctx, key))
    throw data({ error: `You do not hold ${key} in this scope.`, code: "forbidden" }, { status: 403 });
}

/** The last scope the user visited, so `/` and the workspace pages know where "back to the project" goes. */
export const SCOPE_COOKIE = "tpx_scope";

export function readScopeCookie(request: Request): { project: string; environment: string } | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${SCOPE_COOKIE}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(SCOPE_COOKIE.length + 1));
  const [project, environment] = value.split("/");
  return project && environment ? { project, environment } : null;
}

export function scopeCookieHeader(projectSlug: string, environmentName: string): string {
  return `${SCOPE_COOKIE}=${encodeURIComponent(`${projectSlug}/${environmentName}`)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly; Secure`;
}

export const THEME_COOKIE = "tpx_theme";

export function readThemeCookie(request: Request): "light" | "dark" | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${THEME_COOKIE}=`));
  const value = match?.slice(THEME_COOKIE.length + 1);
  return value === "light" || value === "dark" ? value : null;
}

/** What each service says about itself; products without a binding are previews or hidden. */
export async function productCapabilities(env: WebEnv): Promise<Record<string, ProductCapabilities | null>> {
  const preview = previewProducts(env);
  const out: Record<string, ProductCapabilities | null> = {};
  await Promise.all(
    products.map(async (manifest) => {
      const binding = manifest.binding
        ? (env[manifest.binding] as { capabilities?(): Promise<ProductCapabilities> } | undefined)
        : undefined;
      if (binding?.capabilities) {
        try {
          out[manifest.id] = await binding.capabilities();
          return;
        } catch (error) {
          console.error(`capabilities() failed for ${manifest.id}`, error);
          out[manifest.id] = { product: manifest.id, enabled: false, features: [], version: "unavailable" };
          return;
        }
      }
      out[manifest.id] = preview.has(manifest.id)
        ? { product: manifest.id, enabled: true, features: ["preview"], version: "preview" }
        : null;
    }),
  );
  return out;
}
