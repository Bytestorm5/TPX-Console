/**
 * The data the Frame needs, assembled once per navigation by the two shell
 * layouts (scoped and workspace).
 */
import type { LoaderFunctionArgs } from "react-router";
import type { Environment, Project } from "@tpx/contracts/auth";
import { cloudflareContext, type ScopeSession, type TenantSession } from "./context.ts";
import { isFixtureMode } from "./env.ts";
import { buildProductGroups, buildWorkspaceGroup } from "./nav.ts";
import { rpc } from "./rpc.server.ts";
import { productCapabilities, readThemeCookie } from "./session.server.ts";
import { scopePath } from "./scope.ts";
import type { SidebarProps } from "./components/Sidebar.tsx";
import { products } from "../registry.ts";

export async function sidebarFor(
  args: Pick<LoaderFunctionArgs, "request" | "context">,
  session: TenantSession,
  scope: Pick<ScopeSession, "project" | "environment" | "environments" | "ctx"> | null,
): Promise<{ sidebar: SidebarProps; projects: Project[] }> {
  const { env } = args.context.get(cloudflareContext);
  const [projects, capabilities] = await Promise.all([
    rpc(env.AUTH.listProjects(session.tenantCtx)),
    productCapabilities(env),
  ]);
  const scopeBase = scope ? scopePath(scope.project.slug, scope.environment.name) : null;
  const environments: Environment[] = scope ? scope.environments : [];
  const productGroups = buildProductGroups({
    manifests: products,
    scopeBase,
    grants: scope ? scope.ctx.grants : [],
    tenantGrants: session.tenantCtx.grants,
    capabilities,
  });
  return {
    projects,
    sidebar: {
      mode: isFixtureMode(env) ? "fixture" : "clerk",
      tenantId: session.tenant.id,
      tenantName: session.tenant.name,
      tenants: session.tenants,
      user: { name: session.identity.displayName, email: session.identity.email },
      projects,
      project: scope?.project ?? null,
      environments,
      environment: scope?.environment ?? null,
      scopeBase,
      productGroups,
      workspace: buildWorkspaceGroup({ tenantGrants: session.tenantCtx.grants }),
      theme: readThemeCookie(args.request),
    },
  };
}
