import { Radar, LayoutDashboard } from "lucide-react";
import type { ProductManifest } from "~/shell/manifest.ts";

/**
 * Integrator — a preview manifest. The product has no service yet, so it
 * names none; the shell shows it only while `TPX_PREVIEW_PRODUCTS` lists it,
 * badged "preview". Replacing this with the real product means mounting its
 * service, naming it here and adding the routes in `routes.ts` — nothing
 * else in the shell changes.
 */
const manifest: ProductManifest = {
  id: "integrator",
  title: "Integrator",
  description: "Contract monitoring and change detection.",
  icon: Radar,
  requires: "tpx.integrator.*",
  nav: [{ path: "integrator", label: "Overview", icon: LayoutDashboard, requires: "tpx.integrator.overview.read" }],
};

export default manifest;
