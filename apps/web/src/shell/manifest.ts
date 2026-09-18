/**
 * What a product exports and the shell consumes. Manifest paths are
 * scope-relative: the shell mounts them under `/<project>/<environment>/`,
 * so no product ever builds a scoped URL itself.
 */
import type { LucideIcon } from "lucide-react";
import type { ProductId } from "@tpx/contracts/product";
import type { TpxKey, TpxPattern } from "@tpx/identity";

export interface NavEntry {
  /** Scope-relative path: `connections/marketplace`. */
  path: string;
  label: string;
  icon?: LucideIcon;
  /** A concrete key (or all of several) the user must hold at the scope. */
  requires?: TpxKey | readonly TpxKey[];
  /** A feature the service must advertise in `capabilities()`. */
  requiresFeature?: string;
}

/** The services the Worker mounts (see `services.server.ts`), by the name a manifest uses. */
export type ServiceId = "auth" | "connections";

export interface ProductManifest {
  id: ProductId;
  title: string;
  description: string;
  icon: LucideIcon;
  /** The mounted service that serves this product, when it exists. */
  service?: ServiceId;
  /** Visibility: the product renders only if the user holds anything under this pattern. */
  requires: TpxPattern;
  nav: readonly NavEntry[];
}
