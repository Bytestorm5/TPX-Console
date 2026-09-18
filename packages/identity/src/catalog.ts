/**
 * The console's Alfiz catalog — the single source of truth for permissions.
 *
 * Keys are `tpx.<product>.<tab>.<permission>` (depth 4: the namespace, then a
 * level that mirrors the console's product structure). Every product is a
 * group at the second level, so `tpx.connections.*` is exactly "everything
 * Connections can do" and a role can be granted a whole product at once.
 *
 * Scope types model the console's hierarchy: environment → project → tenant.
 * Each leaf declares where it may be granted. Tenant-only leaves (creating a
 * connection, managing grants) can never be conferred by a project-scoped
 * grant — Alfiz's `appliesAt` enforces that at check time, which is what makes
 * "a contractor on one client site" safe by construction.
 */
import { defineCatalog, group } from "@alfiz/core";
import type { ClientOf, KeyOf, PatternOf, ScopeOf, SnapshotOf } from "@alfiz/core";

export const TENANT_SCOPE_TYPE = "tpx.tenant" as const;
export const PROJECT_SCOPE_TYPE = "tpx.project" as const;
export const ENVIRONMENT_SCOPE_TYPE = "tpx.environment" as const;

const EVERY_LEVEL = [TENANT_SCOPE_TYPE, PROJECT_SCOPE_TYPE, ENVIRONMENT_SCOPE_TYPE] as const;
const TENANT_ONLY = [TENANT_SCOPE_TYPE] as const;
const TENANT_OR_PROJECT = [TENANT_SCOPE_TYPE, PROJECT_SCOPE_TYPE] as const;

export const workspace = group(
  "tpx.workspace",
  {
    label: "Workspace",
    description: "Tenant-level settings: projects, environments, members, access, audit.",
    scopes: TENANT_ONLY,
  },
  {
    "tpx.workspace.projects.read": { kind: "read", label: "View projects", scopes: EVERY_LEVEL },
    "tpx.workspace.projects.create_project": { label: "Create projects" },
    "tpx.workspace.projects.update_project": { label: "Rename or archive projects", scopes: TENANT_OR_PROJECT },
    "tpx.workspace.projects.delete": { label: "Delete projects", destructive: true },
    "tpx.workspace.environments.read": { kind: "read", label: "View environments", scopes: EVERY_LEVEL },
    "tpx.workspace.environments.add_environment": {
      label: "Add an environment to a project",
      scopes: TENANT_OR_PROJECT,
    },
    "tpx.workspace.environments.update_vocabulary": { label: "Change the environment vocabulary" },
    "tpx.workspace.settings.read": { kind: "read", label: "View tenant settings" },
    "tpx.workspace.settings.update_settings": { label: "Rename the tenant" },
    "tpx.workspace.members.read": { kind: "read", label: "View members" },
    "tpx.workspace.members.manage_members": { label: "Invite and remove members" },
    "tpx.workspace.access.read": { kind: "read", label: "View grants and roles" },
    "tpx.workspace.access.manage_grants": { label: "Create and delete grants" },
    "tpx.workspace.audit.read": { kind: "read", label: "Read the tenant audit log" },
  },
);

export const connections = group(
  "tpx.connections",
  {
    label: "Connections",
    description: "The connections marketplace: credentials, attachments, bindings.",
    scopes: EVERY_LEVEL,
  },
  {
    "tpx.connections.marketplace.read": { kind: "read", label: "Browse the marketplace" },
    "tpx.connections.marketplace.create_connection": { label: "Connect a provider", scopes: TENANT_ONLY },
    "tpx.connections.connections.read": { kind: "read", label: "View connections (redacted)" },
    "tpx.connections.connections.update_connection": { label: "Edit a connection's config", scopes: TENANT_ONLY },
    "tpx.connections.connections.rotate_credential": { label: "Set or rotate a credential", scopes: TENANT_ONLY },
    "tpx.connections.connections.reveal_secret": {
      label: "Reveal a stored secret",
      description: "Audited every time. Paired with a fresh (uncached) check at ingress.",
      scopes: TENANT_ONLY,
    },
    "tpx.connections.connections.test_connection": { label: "Run a live connection test", scopes: TENANT_ONLY },
    "tpx.connections.connections.delete": { label: "Delete a connection", destructive: true, scopes: TENANT_ONLY },
    "tpx.connections.attachments.read": { kind: "read", label: "View a project's attachments" },
    "tpx.connections.attachments.attach_connection": { label: "Attach a connection to a project" },
    "tpx.connections.attachments.update_attachment": { label: "Edit attachment overrides" },
    "tpx.connections.attachments.detach_connection": { label: "Detach a connection from a project" },
    "tpx.connections.bindings.read": { kind: "read", label: "View environment bindings" },
    "tpx.connections.bindings.update_binding": { label: "Set environment overrides" },
    "tpx.connections.bindings.clear_binding": { label: "Clear environment overrides" },
    "tpx.connections.bindings.promote_binding": {
      label: "Promote values between environments",
      scopes: TENANT_OR_PROJECT,
    },
    "tpx.connections.usage.read": { kind: "read", label: "See which capabilities resolve" },
    "tpx.connections.usage.execute_capability": { label: "Execute a capability through a connection" },
    "tpx.connections.audit.read": { kind: "read", label: "Read the connections audit log" },
    "tpx.connections.audit.export_audit": { label: "Export the audit log", scopes: TENANT_ONLY },
  },
);

export const operator = group(
  "tpx.operator",
  { label: "Operator", description: "Ops state and actions.", scopes: EVERY_LEVEL },
  {
    "tpx.operator.overview.read": { kind: "read", label: "View Operator" },
    "tpx.operator.overview.manage_servers": { label: "Act on servers" },
  },
);

export const dispatcher = group(
  "tpx.dispatcher",
  { label: "Dispatcher", description: "Tickets, classification, agent dispatch.", scopes: EVERY_LEVEL },
  {
    "tpx.dispatcher.overview.read": { kind: "read", label: "View Dispatcher" },
    "tpx.dispatcher.overview.manage_tickets": { label: "Act on tickets" },
  },
);

export const integrator = group(
  "tpx.integrator",
  { label: "Integrator", description: "Contract monitoring and change detection.", scopes: EVERY_LEVEL },
  {
    "tpx.integrator.overview.read": { kind: "read", label: "View Integrator" },
    "tpx.integrator.overview.manage_monitors": { label: "Configure monitors" },
  },
);

export const catalog = defineCatalog({
  namespaces: ["tpx"],
  permissions: [workspace, connections, operator, dispatcher, integrator],
  groups: {
    tpx: { label: "Trusplex Console" },
    "tpx.workspace.projects": { label: "Projects" },
    "tpx.workspace.environments": { label: "Environments" },
    "tpx.workspace.settings": { label: "Settings" },
    "tpx.workspace.members": { label: "Members" },
    "tpx.workspace.access": { label: "Access" },
    "tpx.workspace.audit": { label: "Audit" },
    "tpx.connections.marketplace": { label: "Marketplace" },
    "tpx.connections.connections": { label: "Connections" },
    "tpx.connections.attachments": { label: "Attachments" },
    "tpx.connections.bindings": { label: "Bindings" },
    "tpx.connections.usage": { label: "Usage" },
    "tpx.connections.audit": { label: "Audit" },
    "tpx.operator.overview": { label: "Overview" },
    "tpx.dispatcher.overview": { label: "Overview" },
    "tpx.integrator.overview": { label: "Overview" },
  },
  scopeTypes: {
    [TENANT_SCOPE_TYPE]: {
      description: "A tenant — the billing and identity boundary; one per Clerk organization.",
      parent: null,
    },
    [PROJECT_SCOPE_TYPE]: {
      description: "A unit of delivered work within a tenant.",
      parent: TENANT_SCOPE_TYPE,
    },
    [ENVIRONMENT_SCOPE_TYPE]: {
      description: "A target within a project: prod, dev, stage …",
      parent: PROJECT_SCOPE_TYPE,
    },
  },
  conventions: { depth: 4 },
  includeAlfizInternal: false,
});

export type TpxCatalog = typeof catalog;
export type TpxKey = KeyOf<TpxCatalog>;
export type TpxPattern = PatternOf<TpxCatalog>;
export type TpxScopeId = ScopeOf<TpxCatalog>;
export type TpxClient = ClientOf<TpxCatalog>;
export type TpxSnapshot = SnapshotOf<TpxCatalog>;

/** The product a key belongs to: `tpx.connections.bindings.read` → `connections`. */
export function productOfKey(key: string): string | null {
  const parts = key.split(".");
  return parts[0] === "tpx" && parts.length >= 3 ? (parts[1] ?? null) : null;
}
