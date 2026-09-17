import { Server, LayoutDashboard } from "lucide-react";
import type { ProductManifest } from "~/shell/manifest.ts";

/**
 * Operator — a preview manifest. The product has no service yet, so it
 * declares no binding; the shell shows it only while `TPX_PREVIEW_PRODUCTS`
 * lists it, badged "preview". Replacing this with the real product means
 * adding the binding here and the routes in `routes.ts` — nothing in the
 * shell changes.
 */
const manifest: ProductManifest = {
  id: "operator",
  title: "Operator",
  description: "Ops state and actions for the servers a project runs on.",
  icon: Server,
  requires: "tpx.operator.*",
  nav: [{ path: "operator", label: "Overview", icon: LayoutDashboard, requires: "tpx.operator.overview.read" }],
};

export default manifest;
