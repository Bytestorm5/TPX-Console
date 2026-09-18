/**
 * tpx-connections' tables (prefix `connections_`). Every table carries
 * tenantId; project- and environment-shaped rows carry those ids too. The
 * secrets table holds ciphertext only: the Worker encrypts before writing and
 * decrypts after reading, and Convex never sees a plaintext credential.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

const values = v.record(v.string(), v.string());

export const connectionsTables = {
  connections_connections: defineTable({
    connectionId: v.string(),
    tenantId: v.string(),
    provider: v.string(),
    name: v.string(),
    capabilities: v.array(v.string()),
    config: values,
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastTest: v.union(v.null(), v.object({ at: v.number(), ok: v.boolean(), message: v.string() })),
  })
    .index("by_connectionId", ["connectionId"])
    .index("by_tenant", ["tenantId", "createdAt"]),

  connections_environmentDefaults: defineTable({
    connectionId: v.string(),
    tenantId: v.string(),
    environmentName: v.string(),
    config: values,
  })
    .index("by_connection_env", ["connectionId", "environmentName"])
    .index("by_connection", ["connectionId"]),

  connections_secrets: defineTable({
    secretId: v.string(),
    tenantId: v.string(),
    ownerKind: v.string(),
    ownerId: v.string(),
    /** environment NAME for connection-environment rows, environment ID for bindings, "" otherwise. */
    environmentKey: v.string(),
    key: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    wrappedDek: v.string(),
    dekIv: v.string(),
    keyVersion: v.string(),
    hint: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["tenantId", "ownerKind", "ownerId", "environmentKey"])
    .index("by_owner_key", ["tenantId", "ownerKind", "ownerId", "environmentKey", "key"]),

  connections_attachments: defineTable({
    attachmentId: v.string(),
    tenantId: v.string(),
    projectId: v.string(),
    connectionId: v.string(),
    name: v.string(),
    capability: v.string(),
    isDefault: v.boolean(),
    config: values,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_attachmentId", ["attachmentId"])
    .index("by_tenant_project", ["tenantId", "projectId", "createdAt"])
    .index("by_connection", ["connectionId"])
    .index("by_project_capability_name", ["projectId", "capability", "name"]),

  connections_bindings: defineTable({
    attachmentId: v.string(),
    environmentId: v.string(),
    tenantId: v.string(),
    projectId: v.string(),
    config: values,
    updatedAt: v.number(),
  })
    .index("by_attachment_env", ["attachmentId", "environmentId"])
    .index("by_attachment", ["attachmentId"]),

  connections_audit: defineTable({
    auditId: v.string(),
    tenantId: v.string(),
    projectId: v.union(v.string(), v.null()),
    environmentId: v.union(v.string(), v.null()),
    userId: v.string(),
    action: v.string(),
    target: v.string(),
    level: v.union(v.string(), v.null()),
    at: v.number(),
    detail: v.optional(v.any()),
  })
    .index("by_tenant_at", ["tenantId", "at"])
    .index("by_tenant_project_at", ["tenantId", "projectId", "at"]),
};
