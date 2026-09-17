import { Outlet } from "react-router";
import type { Route } from "./+types/org";
import { ErrorSection } from "../shell/components/ErrorSection.tsx";
import { Frame } from "../shell/components/Frame.tsx";
import { requireTenant, tenantMiddleware } from "../shell/session.server.ts";
import { sidebarFor } from "../shell/shell.server.ts";

/** The workspace shell: tenant-level pages under `/org/…`. */
export const middleware: Route.MiddlewareFunction[] = [tenantMiddleware];

export async function loader(args: Route.LoaderArgs) {
  const session = requireTenant(args);
  const { sidebar } = await sidebarFor(args, session, null);
  return { sidebar, tenant: session.tenant, tenantCtx: session.tenantCtx };
}

export default function OrgLayout({ loaderData }: Route.ComponentProps) {
  return (
    <Frame sidebar={loaderData.sidebar}>
      <Outlet />
    </Frame>
  );
}

export function ErrorBoundary() {
  return <ErrorSection />;
}
