/**
 * Route configuration only runs in the build tooling, so it lives beside the
 * runtime registry rather than inside the manifests (which ship to the
 * browser). Each product owns its route list; the shell mounts them under
 * `/<project>/<environment>/`.
 */
import type { RouteConfigEntry } from "@react-router/dev/routes";
import { connectionsRoutes } from "./products/connections/routes.ts";
import { dispatcherRoutes } from "./products/dispatcher/routes.ts";
import { integratorRoutes } from "./products/integrator/routes.ts";
import { operatorRoutes } from "./products/operator/routes.ts";

export const productRoutes: RouteConfigEntry[] = [
  ...connectionsRoutes,
  ...operatorRoutes,
  ...dispatcherRoutes,
  ...integratorRoutes,
];
