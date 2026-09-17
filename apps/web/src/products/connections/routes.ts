import { layout, route, type RouteConfigEntry } from "@react-router/dev/routes";

/** Mounted by the shell under `/<project>/<environment>/`. */
export const connectionsRoutes: RouteConfigEntry[] = [
  layout("products/connections/layout.tsx", [
    route("connections", "products/connections/routes/connected.tsx"),
    route("connections/marketplace", "products/connections/routes/marketplace.tsx"),
    route("connections/c/:connectionId", "products/connections/routes/connection.tsx"),
    route("connections/attachments", "products/connections/routes/attachments.tsx"),
    route("connections/attachments/:attachmentId", "products/connections/routes/attachment.tsx"),
    route("connections/audit", "products/connections/routes/audit.tsx"),
  ]),
];
