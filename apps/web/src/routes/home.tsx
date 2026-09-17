import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { cloudflareContext } from "../shell/context.ts";
import { rpc } from "../shell/rpc.server.ts";
import { readScopeCookie, resolveTenantSession } from "../shell/session.server.ts";
import { scopePath } from "../shell/scope.ts";

/**
 * `/` is never a page: it lands the user in their last scope, else the first
 * project's default environment, else the projects page.
 */
export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = await resolveTenantSession(args);
  const remembered = readScopeCookie(args.request);
  if (remembered) {
    const resolved = await rpc(
      env.AUTH.resolveScope({
        tenantId: session.tenant.id,
        projectSlug: remembered.project,
        environmentName: remembered.environment,
      }),
    );
    if (resolved) throw redirect(scopePath(resolved.project.slug, resolved.environment.name));
  }
  const projects = await rpc(env.AUTH.listProjects(session.tenantCtx));
  const first = projects.find((p) => p.archivedAt === null);
  if (first) throw redirect(`/${first.slug}`);
  throw redirect("/org/projects");
}

export default function Home() {
  return null;
}
