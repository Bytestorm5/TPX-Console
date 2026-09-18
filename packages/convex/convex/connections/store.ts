/**
 * tpx-connections' store seam as Convex internal functions. Rows in, rows
 * out; cascades are transactional because a mutation is one transaction.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

const values = v.record(v.string(), v.string());
const lastTest = v.union(v.null(), v.object({ at: v.number(), ok: v.boolean(), message: v.string() }));
const ownerRef = v.object({ ownerKind: v.string(), ownerId: v.string(), environmentKey: v.string() });

const connectionRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  provider: v.string(),
  name: v.string(),
  capabilities: v.array(v.string()),
  config: values,
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastTest,
});
const environmentDefaultRow = v.object({
  connectionId: v.string(),
  tenantId: v.string(),
  environmentName: v.string(),
  config: values,
});
const secretRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  ownerKind: v.string(),
  ownerId: v.string(),
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
});
const attachmentRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  projectId: v.string(),
  connectionId: v.string(),
  name: v.string(),
  capability: v.string(),
  isDefault: v.boolean(),
  config: values,
  createdAt: v.number(),
  updatedAt: v.number(),
});
const bindingRow = v.object({
  attachmentId: v.string(),
  environmentId: v.string(),
  tenantId: v.string(),
  projectId: v.string(),
  config: values,
  updatedAt: v.number(),
});
const auditRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  projectId: v.union(v.string(), v.null()),
  environmentId: v.union(v.string(), v.null()),
  userId: v.string(),
  action: v.string(),
  target: v.string(),
  level: v.union(v.string(), v.null()),
  at: v.number(),
  detail: v.optional(v.any()),
});

const connectionOut = (d: Doc<"connections_connections">) => ({
  id: d.connectionId,
  tenantId: d.tenantId,
  provider: d.provider,
  name: d.name,
  capabilities: d.capabilities,
  config: d.config,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  lastTest: d.lastTest,
});
const environmentDefaultOut = (d: Doc<"connections_environmentDefaults">) => ({
  connectionId: d.connectionId,
  tenantId: d.tenantId,
  environmentName: d.environmentName,
  config: d.config,
});
const secretOut = (d: Doc<"connections_secrets">) => ({
  id: d.secretId,
  tenantId: d.tenantId,
  ownerKind: d.ownerKind,
  ownerId: d.ownerId,
  environmentKey: d.environmentKey,
  key: d.key,
  ciphertext: d.ciphertext,
  iv: d.iv,
  wrappedDek: d.wrappedDek,
  dekIv: d.dekIv,
  keyVersion: d.keyVersion,
  hint: d.hint,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const attachmentOut = (d: Doc<"connections_attachments">) => ({
  id: d.attachmentId,
  tenantId: d.tenantId,
  projectId: d.projectId,
  connectionId: d.connectionId,
  name: d.name,
  capability: d.capability,
  isDefault: d.isDefault,
  config: d.config,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});
const bindingOut = (d: Doc<"connections_bindings">) => ({
  attachmentId: d.attachmentId,
  environmentId: d.environmentId,
  tenantId: d.tenantId,
  projectId: d.projectId,
  config: d.config,
  updatedAt: d.updatedAt,
});
const auditOut = (d: Doc<"connections_audit">) => ({
  id: d.auditId,
  tenantId: d.tenantId,
  projectId: d.projectId,
  environmentId: d.environmentId,
  userId: d.userId,
  action: d.action,
  target: d.target,
  level: d.level,
  at: d.at,
  ...(d.detail === undefined ? {} : { detail: d.detail as unknown }),
});

async function connectionDoc(ctx: QueryCtx | MutationCtx, tenantId: string, connectionId: string) {
  const row = await ctx.db
    .query("connections_connections")
    .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
    .unique();
  return row && row.tenantId === tenantId ? row : null;
}
async function attachmentDoc(ctx: QueryCtx | MutationCtx, tenantId: string, attachmentId: string) {
  const row = await ctx.db
    .query("connections_attachments")
    .withIndex("by_attachmentId", (q) => q.eq("attachmentId", attachmentId))
    .unique();
  return row && row.tenantId === tenantId ? row : null;
}
async function secretsOfOwner(
  ctx: QueryCtx | MutationCtx,
  tenantId: string,
  owner: { ownerKind: string; ownerId: string; environmentKey: string },
) {
  return ctx.db
    .query("connections_secrets")
    .withIndex("by_owner", (q) =>
      q
        .eq("tenantId", tenantId)
        .eq("ownerKind", owner.ownerKind)
        .eq("ownerId", owner.ownerId)
        .eq("environmentKey", owner.environmentKey),
    )
    .collect();
}
/** Every secret of an owner id under a kind, across environment keys (cascades). */
async function secretsOfOwnerId(ctx: MutationCtx, tenantId: string, ownerKind: string, ownerId: string) {
  return ctx.db
    .query("connections_secrets")
    .withIndex("by_owner", (q) => q.eq("tenantId", tenantId).eq("ownerKind", ownerKind).eq("ownerId", ownerId))
    .collect();
}
async function deleteAttachmentCascade(ctx: MutationCtx, att: Doc<"connections_attachments">) {
  for (const b of await ctx.db
    .query("connections_bindings")
    .withIndex("by_attachment", (q) => q.eq("attachmentId", att.attachmentId))
    .collect()) {
    await ctx.db.delete(b._id);
  }
  for (const kind of ["attachment", "binding"]) {
    for (const s of await secretsOfOwnerId(ctx, att.tenantId, kind, att.attachmentId)) await ctx.db.delete(s._id);
  }
  await ctx.db.delete(att._id);
}

// -- connections ------------------------------------------------------------------
export const listConnections = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    (
      await ctx.db
        .query("connections_connections")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .order("asc")
        .collect()
    ).map(connectionOut),
});

export const getConnection = internalQuery({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, { tenantId, connectionId }) => {
    const row = await connectionDoc(ctx, tenantId, connectionId);
    return row ? connectionOut(row) : null;
  },
});

export const insertConnection = internalMutation({
  args: { row: connectionRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("connections_connections")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", row.id))
      .unique();
    if (existing) throw new Error(`connection ${row.id} already exists`);
    await ctx.db.insert("connections_connections", {
      connectionId: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      name: row.name,
      capabilities: row.capabilities,
      config: row.config,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTest: row.lastTest,
    });
  },
});

export const updateConnection = internalMutation({
  args: {
    tenantId: v.string(),
    connectionId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      config: v.optional(values),
      capabilities: v.optional(v.array(v.string())),
      lastTest: v.optional(lastTest),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, { tenantId, connectionId, patch }) => {
    const row = await connectionDoc(ctx, tenantId, connectionId);
    if (!row) throw new Error("connection not found");
    await ctx.db.patch(row._id, {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.capabilities === undefined ? {} : { capabilities: patch.capabilities }),
      ...(patch.lastTest === undefined ? {} : { lastTest: patch.lastTest }),
      updatedAt: patch.updatedAt,
    });
  },
});

export const deleteConnection = internalMutation({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, { tenantId, connectionId }) => {
    const row = await connectionDoc(ctx, tenantId, connectionId);
    if (!row) return;
    for (const d of await ctx.db
      .query("connections_environmentDefaults")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect()) {
      await ctx.db.delete(d._id);
    }
    for (const kind of ["connection-base", "connection-environment"]) {
      for (const s of await secretsOfOwnerId(ctx, tenantId, kind, connectionId)) await ctx.db.delete(s._id);
    }
    for (const att of await ctx.db
      .query("connections_attachments")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect()) {
      if (att.tenantId === tenantId) await deleteAttachmentCascade(ctx, att);
    }
    await ctx.db.delete(row._id);
  },
});

// -- environment defaults ---------------------------------------------------------
export const listEnvironmentDefaults = internalQuery({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, { tenantId, connectionId }) =>
    (
      await ctx.db
        .query("connections_environmentDefaults")
        .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
        .collect()
    )
      .filter((d) => d.tenantId === tenantId)
      .map(environmentDefaultOut),
});

export const upsertEnvironmentDefault = internalMutation({
  args: { row: environmentDefaultRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("connections_environmentDefaults")
      .withIndex("by_connection_env", (q) =>
        q.eq("connectionId", row.connectionId).eq("environmentName", row.environmentName),
      )
      .unique();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("connections_environmentDefaults", row);
  },
});

// -- secrets ----------------------------------------------------------------------
export const listSecrets = internalQuery({
  args: { tenantId: v.string(), owners: v.array(ownerRef) },
  handler: async (ctx, { tenantId, owners }) => {
    const out: Doc<"connections_secrets">[] = [];
    for (const owner of owners) out.push(...(await secretsOfOwner(ctx, tenantId, owner)));
    return out.map(secretOut);
  },
});

export const upsertSecret = internalMutation({
  args: { row: secretRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("connections_secrets")
      .withIndex("by_owner_key", (q) =>
        q
          .eq("tenantId", row.tenantId)
          .eq("ownerKind", row.ownerKind)
          .eq("ownerId", row.ownerId)
          .eq("environmentKey", row.environmentKey)
          .eq("key", row.key),
      )
      .unique();
    const doc = {
      secretId: row.id,
      tenantId: row.tenantId,
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      environmentKey: row.environmentKey,
      key: row.key,
      ciphertext: row.ciphertext,
      iv: row.iv,
      wrappedDek: row.wrappedDek,
      dekIv: row.dekIv,
      keyVersion: row.keyVersion,
      hint: row.hint,
      createdAt: existing?.createdAt ?? row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("connections_secrets", doc);
  },
});

export const deleteSecret = internalMutation({
  args: { tenantId: v.string(), owner: ownerRef, key: v.string() },
  handler: async (ctx, { tenantId, owner, key }) => {
    const existing = await ctx.db
      .query("connections_secrets")
      .withIndex("by_owner_key", (q) =>
        q
          .eq("tenantId", tenantId)
          .eq("ownerKind", owner.ownerKind)
          .eq("ownerId", owner.ownerId)
          .eq("environmentKey", owner.environmentKey)
          .eq("key", key),
      )
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const deleteSecretsForOwner = internalMutation({
  args: { tenantId: v.string(), owner: ownerRef },
  handler: async (ctx, { tenantId, owner }) => {
    for (const s of await secretsOfOwner(ctx, tenantId, owner)) await ctx.db.delete(s._id);
  },
});

// -- attachments ------------------------------------------------------------------
export const listAttachments = internalQuery({
  args: { tenantId: v.string(), projectId: v.string() },
  handler: async (ctx, { tenantId, projectId }) =>
    (
      await ctx.db
        .query("connections_attachments")
        .withIndex("by_tenant_project", (q) => q.eq("tenantId", tenantId).eq("projectId", projectId))
        .order("asc")
        .collect()
    ).map(attachmentOut),
});

export const getAttachment = internalQuery({
  args: { tenantId: v.string(), attachmentId: v.string() },
  handler: async (ctx, { tenantId, attachmentId }) => {
    const row = await attachmentDoc(ctx, tenantId, attachmentId);
    return row ? attachmentOut(row) : null;
  },
});

export const listAttachmentsForConnection = internalQuery({
  args: { tenantId: v.string(), connectionId: v.string() },
  handler: async (ctx, { tenantId, connectionId }) =>
    (
      await ctx.db
        .query("connections_attachments")
        .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
        .collect()
    )
      .filter((a) => a.tenantId === tenantId)
      .map(attachmentOut),
});

export const insertAttachment = internalMutation({
  args: { row: attachmentRow },
  handler: async (ctx, { row }) => {
    const clash = await ctx.db
      .query("connections_attachments")
      .withIndex("by_project_capability_name", (q) =>
        q.eq("projectId", row.projectId).eq("capability", row.capability).eq("name", row.name),
      )
      .unique();
    if (clash) return false;
    await ctx.db.insert("connections_attachments", {
      attachmentId: row.id,
      tenantId: row.tenantId,
      projectId: row.projectId,
      connectionId: row.connectionId,
      name: row.name,
      capability: row.capability,
      isDefault: row.isDefault,
      config: row.config,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    return true;
  },
});

export const updateAttachment = internalMutation({
  args: {
    tenantId: v.string(),
    attachmentId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      config: v.optional(values),
      isDefault: v.optional(v.boolean()),
      updatedAt: v.number(),
    }),
  },
  handler: async (ctx, { tenantId, attachmentId, patch }) => {
    const row = await attachmentDoc(ctx, tenantId, attachmentId);
    if (!row) throw new Error("attachment not found");
    await ctx.db.patch(row._id, {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.isDefault === undefined ? {} : { isDefault: patch.isDefault }),
      updatedAt: patch.updatedAt,
    });
  },
});

export const setDefaultAttachment = internalMutation({
  args: { tenantId: v.string(), projectId: v.string(), capability: v.string(), attachmentId: v.string() },
  handler: async (ctx, { tenantId, projectId, capability, attachmentId }) => {
    const rows = await ctx.db
      .query("connections_attachments")
      .withIndex("by_tenant_project", (q) => q.eq("tenantId", tenantId).eq("projectId", projectId))
      .collect();
    for (const row of rows) {
      if (row.capability !== capability) continue;
      const shouldBe = row.attachmentId === attachmentId;
      if (row.isDefault !== shouldBe) await ctx.db.patch(row._id, { isDefault: shouldBe });
    }
  },
});

export const deleteAttachment = internalMutation({
  args: { tenantId: v.string(), attachmentId: v.string() },
  handler: async (ctx, { tenantId, attachmentId }) => {
    const row = await attachmentDoc(ctx, tenantId, attachmentId);
    if (row) await deleteAttachmentCascade(ctx, row);
  },
});

// -- bindings ---------------------------------------------------------------------
export const getBinding = internalQuery({
  args: { tenantId: v.string(), attachmentId: v.string(), environmentId: v.string() },
  handler: async (ctx, { tenantId, attachmentId, environmentId }) => {
    const row = await ctx.db
      .query("connections_bindings")
      .withIndex("by_attachment_env", (q) => q.eq("attachmentId", attachmentId).eq("environmentId", environmentId))
      .unique();
    return row && row.tenantId === tenantId ? bindingOut(row) : null;
  },
});

export const listBindings = internalQuery({
  args: { tenantId: v.string(), attachmentId: v.string() },
  handler: async (ctx, { tenantId, attachmentId }) =>
    (
      await ctx.db
        .query("connections_bindings")
        .withIndex("by_attachment", (q) => q.eq("attachmentId", attachmentId))
        .collect()
    )
      .filter((b) => b.tenantId === tenantId)
      .map(bindingOut),
});

export const upsertBinding = internalMutation({
  args: { row: bindingRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("connections_bindings")
      .withIndex("by_attachment_env", (q) =>
        q.eq("attachmentId", row.attachmentId).eq("environmentId", row.environmentId),
      )
      .unique();
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("connections_bindings", row);
  },
});

export const deleteBinding = internalMutation({
  args: { tenantId: v.string(), attachmentId: v.string(), environmentId: v.string() },
  handler: async (ctx, { tenantId, attachmentId, environmentId }) => {
    const row = await ctx.db
      .query("connections_bindings")
      .withIndex("by_attachment_env", (q) => q.eq("attachmentId", attachmentId).eq("environmentId", environmentId))
      .unique();
    if (row && row.tenantId === tenantId) await ctx.db.delete(row._id);
  },
});

// -- audit ------------------------------------------------------------------------
export const recordAudit = internalMutation({
  args: { row: auditRow },
  handler: async (ctx, { row }) => {
    await ctx.db.insert("connections_audit", {
      auditId: row.id,
      tenantId: row.tenantId,
      projectId: row.projectId,
      environmentId: row.environmentId,
      userId: row.userId,
      action: row.action,
      target: row.target,
      level: row.level,
      at: row.at,
      ...(row.detail === undefined ? {} : { detail: row.detail }),
    });
  },
});

export const listAudit = internalQuery({
  args: { tenantId: v.string(), limit: v.number(), projectId: v.optional(v.string()) },
  handler: async (ctx, { tenantId, limit, projectId }) => {
    const take = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows =
      projectId === undefined
        ? await ctx.db
            .query("connections_audit")
            .withIndex("by_tenant_at", (q) => q.eq("tenantId", tenantId))
            .order("desc")
            .take(take)
        : await ctx.db
            .query("connections_audit")
            .withIndex("by_tenant_project_at", (q) => q.eq("tenantId", tenantId).eq("projectId", projectId))
            .order("desc")
            .take(take);
    return rows.map(auditOut);
  },
});
