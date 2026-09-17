import { data, Outlet } from "react-router";
import { catalog } from "@tpx/identity";
import type { Route } from "./+types/layout";
import { ErrorSection } from "~/shell/components/ErrorSection.tsx";
import { requireScope } from "~/shell/session.server.ts";
import manifest from "./manifest.ts";

/**
 * The product layout: one error boundary for the whole subtree, and the
 * product-level gate — nothing under here renders for a user who holds no
 * Connections grant at this scope, whatever the URL.
 */
export async function loader(args: Route.LoaderArgs) {
  const session = requireScope(args);
  const held = catalog.keysMatching(manifest.requires).some((key) => session.ctx.grants.includes(key));
  if (!held)
    throw data({ error: "You do not have access to Connections in this scope.", code: "forbidden" }, { status: 403 });
  return null;
}

export default function ConnectionsLayout() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return <ErrorSection title="Connections is unavailable" />;
}
