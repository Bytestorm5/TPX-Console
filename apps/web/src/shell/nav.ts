/**
 * Builds the sidebar from the registry, the user's grants at the current
 * scope, and each service's capabilities. Visibility is decided on the
 * server (grants, capabilities); which entry is *active* is decided on the
 * client from the location, so client-side navigation keeps it in sync
 * without re-running the shell loader. Pure, so it is unit-tested.
 */
import type { ProductCapabilities } from "@tpx/contracts/product";
import { catalog, productsWithGrants } from "@tpx/identity";
import type { NavEntry, ProductManifest } from "./manifest.ts";

/**
 * Groups travel through loader data, so they carry no components: the
 * sidebar looks icons up again from the manifest (`id` + `path`) on the
 * client, where the registry is also imported.
 */
export interface NavItem {
  label: string;
  to: string;
  /** The manifest entry's scope-relative path (or the absolute path for workspace items). */
  path: string;
}

export interface NavGroup {
  id: string;
  title: string;
  /** Every path under here counts as "inside" the group. */
  base: string;
  /** Where clicking the group header goes: its first visible item. */
  to: string;
  items: NavItem[];
  preview: boolean;
}

export interface NavInput {
  manifests: readonly ProductManifest[];
  /** `/<project>/<environment>` or null when no scope is active. */
  scopeBase: string | null;
  /** Grants at the environment scope (empty without a scope). */
  grants: readonly string[];
  /** Grants at the tenant scope. */
  tenantGrants: readonly string[];
  capabilities: Record<string, ProductCapabilities | null>;
}

export function pathWithin(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isGroupActive(group: Pick<NavGroup, "base">, pathname: string): boolean {
  return pathWithin(pathname, group.base);
}

/** The one item to highlight: the longest entry the location sits under (so a detail page lights its list). */
export function activeItem(group: Pick<NavGroup, "items">, pathname: string): string | null {
  let best: string | null = null;
  for (const item of group.items) {
    if (pathWithin(pathname, item.to) && (best === null || item.to.length > best.length)) best = item.to;
  }
  return best;
}

function entryAllowed(entry: NavEntry, grants: readonly string[], capabilities: ProductCapabilities | null): boolean {
  if (entry.requires) {
    const keys = Array.isArray(entry.requires) ? entry.requires : [entry.requires];
    if (!keys.every((k) => grants.includes(k))) return false;
  }
  if (entry.requiresFeature && !(capabilities?.features ?? []).includes(entry.requiresFeature)) return false;
  return true;
}

export function buildProductGroups(input: NavInput): NavGroup[] {
  if (!input.scopeBase) return [];
  const held = productsWithGrants(input.grants);
  const groups: NavGroup[] = [];
  for (const manifest of input.manifests) {
    const capabilities = input.capabilities[manifest.id] ?? null;
    if (!capabilities?.enabled) continue;
    if (!held.has(manifest.id) || catalog.keysMatching(manifest.requires).every((k) => !input.grants.includes(k)))
      continue;
    const preview = capabilities.features.includes("preview");
    const items: NavItem[] = manifest.nav
      .filter((entry) => entryAllowed(entry, input.grants, capabilities))
      .map((entry) => ({ label: entry.label, to: `${input.scopeBase}/${entry.path}`, path: entry.path }));
    if (items.length === 0) continue;
    groups.push({
      id: manifest.id,
      title: manifest.title,
      base: `${input.scopeBase}/${manifest.id}`,
      to: items[0]?.to ?? input.scopeBase,
      items,
      preview,
    });
  }
  return groups;
}

export const WORKSPACE_ENTRIES: readonly { label: string; to: string; requires?: string }[] = [
  { label: "Projects", to: "/org/projects" },
  { label: "Environments", to: "/org/environments", requires: "tpx.workspace.environments.read" },
  { label: "Members", to: "/org/members", requires: "tpx.workspace.members.read" },
  { label: "Access", to: "/org/access", requires: "tpx.workspace.access.read" },
  { label: "Audit", to: "/org/audit", requires: "tpx.workspace.audit.read" },
];

export function buildWorkspaceGroup(input: Pick<NavInput, "tenantGrants">): NavGroup {
  const items = WORKSPACE_ENTRIES.filter((e) => !e.requires || input.tenantGrants.includes(e.requires)).map((e) => ({
    label: e.label,
    to: e.to,
    path: e.to,
  }));
  return { id: "workspace", title: "Workspace", base: "/org", to: "/org/projects", items, preview: false };
}
