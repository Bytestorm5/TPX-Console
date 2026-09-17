import { Cable, Link2, Plug, ScrollText, Store } from "lucide-react";
import type { ProductManifest } from "~/shell/manifest.ts";

/**
 * Connections: credentials, connectors and the capability contracts every
 * other product builds on. Served by the tpx-connections Worker.
 */
const manifest: ProductManifest = {
  id: "connections",
  title: "Connections",
  description: "Credentials, connectors and the capability contracts products build on.",
  icon: Plug,
  binding: "CONNECTIONS",
  requires: "tpx.connections.*",
  nav: [
    { path: "connections", label: "Connected", icon: Cable, requires: "tpx.connections.connections.read" },
    {
      path: "connections/marketplace",
      label: "Marketplace",
      icon: Store,
      requires: "tpx.connections.marketplace.read",
      requiresFeature: "marketplace",
    },
    {
      path: "connections/attachments",
      label: "Attachments",
      icon: Link2,
      requires: "tpx.connections.attachments.read",
      requiresFeature: "attachments",
    },
    {
      path: "connections/audit",
      label: "Audit",
      icon: ScrollText,
      requires: "tpx.connections.audit.read",
      requiresFeature: "audit",
    },
  ],
};

export default manifest;
