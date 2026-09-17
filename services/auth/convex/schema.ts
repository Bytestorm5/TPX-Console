/**
 * tpx-auth's Convex schema.
 *
 * Two families of tables: tenancy (tenants, projects, environments, the
 * tenant audit log) and the Alfiz storage seam (grants, revokes, roles,
 * groups, users, requests, catalog, audit, and the persisted invalidation
 * log). One Convex deployment per service; tenancy is expressed by scope and
 * subject, never by table.
 *
 * Every row keeps its own opaque id (`grantId`, `projectId`, …) beside the
 * Convex `_id`: Alfiz assigns ids, and the console's URLs and grants reference
 * them, so they must not be Convex document ids.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // -- tenancy ---------------------------------------------------------------
  tenants: defineTable({
    tenantId: v.string(),
    name: v.string(),
    environments: v.array(v.string()),
    projectDefaults: v.array(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
  }).index("by_tenantId", ["tenantId"]),

  projects: defineTable({
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

  environments: defineTable({
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

  tenantAudit: defineTable({
    auditId: v.string(),
    tenantId: v.string(),
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    target: v.string(),
    detail: v.optional(v.any()),
  }).index("by_tenant_at", ["tenantId", "at"]),

  // -- the Alfiz storage seam ------------------------------------------------
  alfizGrants: defineTable({
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

  alfizRevokes: defineTable({
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

  alfizRoles: defineTable({
    roleId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    patterns: v.array(v.string()),
    requestable: v.optional(v.any()),
  }).index("by_roleId", ["roleId"]),

  alfizGroups: defineTable({
    groupId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    parents: v.array(v.string()),
    virtual: v.boolean(),
  }).index("by_groupId", ["groupId"]),

  alfizUsers: defineTable({
    userId: v.string(),
    active: v.boolean(),
    groupIds: v.array(v.string()),
    orgIds: v.array(v.string()),
    managerUserId: v.union(v.string(), v.null()),
  }).index("by_userId", ["userId"]),

  alfizMemberships: defineTable({
    userId: v.string(),
    groupId: v.string(),
  })
    .index("by_groupId", ["groupId"])
    .index("by_userId", ["userId"]),

  alfizRequests: defineTable({
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

  alfizCatalog: defineTable({
    version: v.number(),
    document: v.any(),
    publishedAt: v.number(),
  }).index("by_version", ["version"]),

  alfizImports: defineTable({
    key: v.literal("singleton"),
    version: v.number(),
    manifest: v.any(),
  }).index("by_key", ["key"]),

  alfizAudit: defineTable({
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

  alfizEpoch: defineTable({
    key: v.literal("singleton"),
    seq: v.number(),
    prunedThrough: v.number(),
  }).index("by_key", ["key"]),

  alfizEvents: defineTable({
    seq: v.number(),
    type: v.string(),
    payload: v.any(),
    at: v.number(),
  })
    .index("by_seq", ["seq"])
    .index("by_at", ["at"]),
});
