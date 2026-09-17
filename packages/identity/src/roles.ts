/**
 * Seed roles. Role definitions are org-root data in Alfiz; the console seeds a
 * shared vocabulary of four roles that every tenant assigns at its own scope:
 *
 *   tpx-owner   everything, forward-inclusive (`tpx.*`)
 *   tpx-admin   everything except destructive actions and secret reveals
 *   tpx-member  every read plus the day-to-day product actions
 *   tpx-viewer  every read
 *
 * Ids are fixed so migrations, seeding and the UI agree on identity; names are
 * labels and may change freely.
 */
import type { AlfizProvider, Provenance } from "@alfiz/core";
import { catalog as tpxCatalog, type TpxKey } from "./catalog.ts";

export const ROLE_IDS = {
  owner: "tpx-owner",
  admin: "tpx-admin",
  member: "tpx-member",
  viewer: "tpx-viewer",
} as const;
export type RoleId = (typeof ROLE_IDS)[keyof typeof ROLE_IDS];

export interface SeedRole {
  id: RoleId;
  name: string;
  description: string;
  patterns: string[];
}

const MEMBER_ACTION_GROUPS = [
  "tpx.connections.attachments",
  "tpx.connections.bindings",
  "tpx.connections.usage",
  "tpx.operator",
  "tpx.dispatcher",
  "tpx.integrator",
];

function leafOf(key: string) {
  const leaf = tpxCatalog.leaf(key);
  if (!leaf) throw new Error(`seed roles: ${key} is not a catalog leaf`);
  return leaf;
}

export function seedRoles(): SeedRole[] {
  const keys = tpxCatalog.ownedKeys as TpxKey[];
  const reads = keys.filter((k) => leafOf(k).kind === "read");
  const admin = keys.filter((k) => !leafOf(k).destructive && !k.endsWith(".reveal_secret"));
  const member = keys.filter((k) => {
    const leaf = leafOf(k);
    if (leaf.kind === "read") return true;
    if (leaf.destructive) return false;
    if (k === "tpx.connections.bindings.promote_binding") return false;
    return MEMBER_ACTION_GROUPS.some((g) => k.startsWith(`${g}.`));
  });
  return [
    {
      id: ROLE_IDS.owner,
      name: "Owner",
      description: "Everything, including what is added later.",
      patterns: ["tpx.*"],
    },
    {
      id: ROLE_IDS.admin,
      name: "Admin",
      description: "Everything except destructive actions and secret reveals.",
      patterns: admin,
    },
    {
      id: ROLE_IDS.member,
      name: "Member",
      description: "Every read plus day-to-day product actions.",
      patterns: member,
    },
    { id: ROLE_IDS.viewer, name: "Viewer", description: "Read-only.", patterns: reads },
  ];
}

export const SEED_PROVENANCE: Provenance = { kind: "system", note: "tpx seed roles" };

function samePatterns(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Creates missing seed roles and updates drifted ones. Idempotent; safe on every boot. */
export async function ensureSeedRoles(provider: AlfizProvider): Promise<{ created: string[]; updated: string[] }> {
  const existing = new Map((await provider.listRoles()).map((r) => [r.id, r]));
  const created: string[] = [];
  const updated: string[] = [];
  for (const role of seedRoles()) {
    const current = existing.get(role.id);
    if (!current) {
      await provider.createRole(
        { id: role.id, name: role.name, description: role.description, patterns: role.patterns },
        SEED_PROVENANCE,
      );
      created.push(role.id);
    } else if (!samePatterns(current.patterns, role.patterns) || current.name !== role.name) {
      await provider.updateRole(
        role.id,
        { name: role.name, description: role.description, patterns: role.patterns },
        SEED_PROVENANCE,
      );
      updated.push(role.id);
    }
  }
  return { created, updated };
}
