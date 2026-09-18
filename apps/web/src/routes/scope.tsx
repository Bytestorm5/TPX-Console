import { data, Outlet } from "react-router";
import type { Route } from "./+types/scope";
import { ErrorSection } from "../shell/components/ErrorSection.tsx";
import { Frame } from "../shell/components/Frame.tsx";
import { requireScope, scopeCookieHeader, scopeMiddleware, tenantCookieHeader } from "../shell/session.server.ts";
import { sidebarFor } from "../shell/shell.server.ts";

/** The scoped shell: `/<project>/<environment>/…`. */
export const middleware: Route.MiddlewareFunction[] = [scopeMiddleware];

export async function loader(args: Route.LoaderArgs) {
  const session = requireScope(args);
  const { sidebar } = await sidebarFor(args, session, session);
  return data(
    {
      sidebar,
      ctx: session.ctx,
      tenant: session.tenant,
      project: session.project,
      environment: session.environment,
      environments: session.environments,
    },
    {
      headers: [
        ["Set-Cookie", tenantCookieHeader(session.tenant.id)],
        ["Set-Cookie", scopeCookieHeader(session.project.slug, session.environment.name)],
      ],
    },
  );
}

export default function ScopeLayout({ loaderData }: Route.ComponentProps) {
  return (
    <Frame sidebar={loaderData.sidebar}>
      <Outlet />
    </Frame>
  );
}

export function ErrorBoundary() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <ErrorSection />
    </div>
  );
}
