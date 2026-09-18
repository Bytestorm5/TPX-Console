/**
 * The auth service's tables (prefix `auth_`): tenancy (tenants, projects,
 * environments, users, memberships, invites, the tenant audit log) and the
 * Alfiz storage seam (grants, revokes, roles, groups, users, requests,
 * catalog, audit, the persisted invalidation log).
 *
 * Every row keeps its own opaque id (`grantId`, `projectId`, …) beside the
 * Convex `_id`: Alfiz assigns ids, and the console's URLs and grants reference
 * them, so they must not be Convex document ids.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const authTables = {
  // -- tenancy ---------------------------------------------------------------
  auth_tenants: defineTable({
    tenantId: v.string(),
    name: v.string(),
    environments: v.array(v.string()),
    projectDefaults: v.array(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_tenantId", ["tenantId"]),

  auth_projects: defineTable({
    projectId: v.string(),
    tenantId: v.string(),
    slug: v.string(),
    name: v.string(),
    createdAt: v.number(),
    archivedAt: v.union(v.number(), v.null()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_tenant_slug", ["tenantId", "slug"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  auth_environments: defineTable({
    environmentId: v.string(),
    tenantId: v.string(),
    projectId: v.string(),
    name: v.string(),
    createdAt: v.number(),
  })
    .index("by_environmentId", ["environmentId"])
    .index("by_project_name", ["projectId", "name"])
    .index("by_project", ["projectId", "createdAt"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  auth_tenantAudit: defineTable({
    auditId: v.string(),
    tenantId: v.string(),
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    detail: v.optional(v.any()),
  }).index("by_tenant_at", ["tenantId", "at"]),

  /** Profile cache: identity comes from Clerk, the console keeps what it needs to show members. */
  auth_users: defineTable({
    userId: v.string(),
    email: v.union(v.string(), v.null()),
    displayName: v.union(v.string(), v.null()),
    imageUrl: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),

  /** Tenant membership — the console's own, mirrored into Alfiz's directory as the user's org ids. */
  auth_memberships: defineTable({
    tenantId: v.string(),
    userId: v.string(),
    joinedAt: v.number(),
    invitedBy: v.union(v.string(), v.null()),
  })
    .index("by_user", ["userId"])
    .index("by_tenant", ["tenantId", "joinedAt"])
    .index("by_tenant_user", ["tenantId", "userId"]),

  /** Pending invitations, keyed by lower-cased email; claimed on the invitee's first sign-in. */
  auth_invites: defineTable({
    inviteId: v.string(),
    tenantId: v.string(),
    email: v.string(),
    roleId: v.string(),
    invitedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_inviteId", ["inviteId"])
    .index("by_tenant", ["tenantId", "createdAt"])
    .index("by_email", ["email"])
    .index("by_tenant_email", ["tenantId", "email"]),

  // -- the Alfiz storage seam ------------------------------------------------
  auth_alfizGrants: defineTable({
    grantId: v.string(),
    subject: v.string(),
    roleId: v.optional(v.string()),
    pattern: v.optional(v.string()),
    scope: v.string(),
    expiresAt: v.optional(v.number()),
    provenance: v.any(),
    createdAt: v.number(),
  })
    .index("by_grantId", ["grantId"])
    .index("by_subject", ["subject"])
    .index("by_scope", ["scope"])
    .index("by_roleId", ["roleId"]),

  auth_alfizRevokes: defineTable({
    revokeId: v.string(),
    userId: v.string(),
    pattern: v.string(),
    scope: v.string(),
    provenance: v.any(),
    createdAt: v.number(),
  })
    .index("by_revokeId", ["revokeId"])
    .index("by_userId", ["userId"])
    .index("by_scope", ["scope"]),

  auth_alfizRoles: defineTable({
    roleId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    patterns: v.array(v.string()),
    requestable: v.optional(v.any()),
  }).index("by_roleId", ["roleId"]),

  auth_alfizGroups: defineTable({
    groupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    parents: v.array(v.string()),
    virtual: v.boolean(),
  }).index("by_groupId", ["groupId"]),

  auth_alfizUsers: defineTable({
    userId: v.string(),
    active: v.boolean(),
    groupIds: v.array(v.string()),
    orgIds: v.array(v.string()),
    managerUserId: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),

  auth_alfizMemberships: defineTable({
    userId: v.string(),
    groupId: v.string(),
  })
    .index("by_groupId", ["groupId"])
    .index("by_userId", ["userId"]),

  auth_alfizRequests: defineTable({
    requestId: v.string(),
    requesterUserId: v.string(),
    state: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  })
    .index("by_requestId", ["requestId"])
    .index("by_state", ["state", "createdAt"])
    .index("by_requester", ["requesterUserId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  auth_alfizCatalog: defineTable({
    version: v.number(),
    document: v.any(),
    publishedAt: v.number(),
  }).index("by_version", ["version"]),

  auth_alfizImports: defineTable({
    key: v.literal("singleton"),
    version: v.number(),
    manifest: v.any(),
  }).index("by_key", ["key"]),

  auth_alfizAudit: defineTable({
    auditId: v.string(),
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    detail: v.optional(v.any()),
    prevHash: v.optional(v.string()),
    hash: v.optional(v.string()),
  })
    .index("by_at", ["at", "auditId"])
    .index("by_target", ["target", "at", "auditId"])
    .index("by_actor", ["actor", "at", "auditId"])
    .index("by_action", ["action", "at", "auditId"]),

  auth_alfizEpoch: defineTable({
    key: v.literal("singleton"),
    seq: v.number(),
    prunedThrough: v.number(),
  }).index("by_key", ["key"]),

  auth_alfizEvents: defineTable({
    seq: v.number(),
    type: v.string(),
    payload: v.any(),
    at: v.number(),
  })
    .index("by_seq", ["seq"])
    .index("by_at", ["at"]),
};
