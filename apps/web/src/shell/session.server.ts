/**
 * From an identity to an authorized session: the tenant (one of the user's
 * memberships in tpx-auth), the scope resolved from the URL, and the grants
 * the user holds there — computed once per request through the Alfiz client
 * over tpx-auth.
 */
import type { LoaderFunctionArgs, MiddlewareFunction } from "react-router";
import { data, redirect } from "react-router";
import type { ProductCapabilities } from "@tpx/contracts/product";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import {
  createTpxClient,
  environmentScope,
  grantsAt,
  hasGrant,
  tenantScope,
  type HasGrants,
  type TpxClient,
  type TpxKey,
} from "@tpx/identity";
import { cloudflareContext, scopeContext, tenantContext, type ScopeSession, type TenantSession } from "./context.ts";
import { previewProducts, type WebEnv } from "./env.ts";
import { fetchProfile, requireSignedIn } from "./identity.server.ts";
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

/**
 * The user's grants at a scope, from the cached Alfiz snapshot — re-read
 * fresh (one uncached round-trip) when the cache says they hold nothing
 * useful there. A user who just created, joined or switched to a tenant
 * must not see a 404 for the cache's revalidation window; a user who truly
 * has nothing there pays one extra call, which is what "nothing" costs.
 */
async function grantsAtScope(env: WebEnv, userId: string, scope: string, need: TpxKey | null): Promise<TpxKey[]> {
  const client = getTpxClient(env);
  const cached = grantsAt(await client.snapshot({ userId }, { scopes: [scope] }), scope);
  if (need ? cached.includes(need) : cached.length > 0) return cached;
  return grantsAt(await client.snapshot({ userId }, { scopes: [scope], fresh: true }), scope);
}

const PROFILE_TTL_MS = 60 * 60 * 1000;

export const TENANT_COOKIE = "tpx_tenant";

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function tenantCookieHeader(tenantId: string): string {
  return `${TENANT_COOKIE}=${encodeURIComponent(tenantId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`;
}

/**
 * Ingress: who (Clerk) → tpx-auth records them, claims invitations and
 * bootstraps a first tenant → which tenant (the remembered one, else the
 * first) → the grants they hold there. Membership is checked here against
 * what tpx-auth returned; a cookie can never name a tenant the user is not in.
 */
export async function resolveTenantSession(
  args: Pick<LoaderFunctionArgs, "request" | "context" | "params">,
): Promise<TenantSession> {
  const { env } = args.context.get(cloudflareContext);
  const identity = await requireSignedIn(args);
  let session = await rpc(env.AUTH.ensureUser({ userId: identity.userId }));
  if (!session.user || session.user.updatedAt < Date.now() - PROFILE_TTL_MS) {
    const profile = await fetchProfile(args, identity);
    session = await rpc(env.AUTH.ensureUser({ userId: identity.userId, profile }));
  }
  const remembered = readCookie(args.request, TENANT_COOKIE);
  const membership = session.tenants.find((t) => t.id === remembered) ?? session.tenants[0];
  if (!membership) throw data({ error: "no tenant" }, { status: 500 });
  const tenant = await rpc(env.AUTH.findTenant(membership.id));
  if (!tenant) throw data({ error: "tenant not found" }, { status: 500 });
  const scope = tenantScope(tenant.id);
  const grants = await grantsAtScope(env, identity.userId, scope, null);
  const tenantCtx: TenantCtx = { tenantId: tenant.id, userId: identity.userId, grants };
  const profile = session.user;
  return {
    identity: {
      userId: identity.userId,
      displayName: profile?.displayName ?? identity.displayName,
      email: profile?.email ?? identity.email,
      imageUrl: profile?.imageUrl ?? identity.imageUrl,
    },
    tenants: session.tenants,
    tenant,
    tenantCtx,
  };
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
  const grants = await grantsAtScope(env, session.identity.userId, scope, "tpx.workspace.projects.read");
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
  const value = readCookie(request, SCOPE_COOKIE);
  if (!value) return null;
  const [project, environment] = value.split("/");
  return project && environment ? { project, environment } : null;
}

export function clearScopeCookieHeader(): string {
  return `${SCOPE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure`;
}

export function scopeCookieHeader(projectSlug: string, environmentName: string): string {
  return `${SCOPE_COOKIE}=${encodeURIComponent(`${projectSlug}/${environmentName}`)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly; Secure`;
}

export const THEME_COOKIE = "tpx_theme";

export function readThemeCookie(request: Request): "light" | "dark" | null {
  const value = readCookie(request, THEME_COOKIE);
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
