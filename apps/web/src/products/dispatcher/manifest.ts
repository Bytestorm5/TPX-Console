import { Ticket, LayoutDashboard } from "lucide-react";
import type { ProductManifest } from "~/shell/manifest.ts";

/**
 * Dispatcher — a preview manifest. The product has no service yet, so it
 * names none; the shell shows it only while `TPX_PREVIEW_PRODUCTS` lists it,
 * badged "preview". Replacing this with the real product means mounting its
 * service, naming it here and adding the routes in `routes.ts` — nothing
 * else in the shell changes.
 */
const manifest: ProductManifest = {
  id: "dispatcher",
  title: "Dispatcher",
  description: "Tickets, classification and agent dispatch.",
  icon: Ticket,
  requires: "tpx.dispatcher.*",
  nav: [{ path: "dispatcher", label: "Overview", icon: LayoutDashboard, requires: "tpx.dispatcher.overview.read" }],
};

export default manifest;
