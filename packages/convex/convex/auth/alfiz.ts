/**
 * The Alfiz storage seam as Convex functions — one internal function per
 * StorageDriver method. Internal, so nothing outside the deployment can call
 * them; the console Worker reaches them over the HTTP API with the deploy key.
 *
 * Semantics match the reference memory driver exactly (filters, audit
 * paging, the contiguous event log) and are pinned by the Alfiz driver
 * conformance suite in test/convex/alfiz-driver.test.ts.
 */
import { v } from "convex/values";
import type { IndexRange, IndexRangeBuilder } from "convex/server";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

const grantRow = v.object({
  id: v.string(),
  subject: v.string(),
  roleId: v.optional(v.string()),
  pattern: v.optional(v.string()),
  scope: v.string(),
  expiresAt: v.optional(v.number()),
  provenance: v.any(),
  createdAt: v.number(),
});
const revokeRow = v.object({
  id: v.string(),
  userId: v.string(),
  pattern: v.string(),
  scope: v.string(),
  provenance: v.any(),
  createdAt: v.number(),
});
const roleRow = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  patterns: v.array(v.string()),
  requestable: v.optional(v.any()),
});
const groupRow = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  parents: v.array(v.string()),
  virtual: v.optional(v.boolean()),
});
const userRow = v.object({
  userId: v.string(),
  active: v.boolean(),
  groupIds: v.array(v.string()),
  orgIds: v.array(v.string()),
  managerUserId: v.union(v.string(), v.null()),
});
const auditRow = v.object({
  id: v.string(),
  at: v.number(),
  actor: v.string(),
  action: v.string(),
  target: v.string(),
  detail: v.optional(v.any()),
  prevHash: v.optional(v.string()),
  hash: v.optional(v.string()),
});
const grantFilter = v.object({
  subject: v.optional(v.string()),
  subjects: v.optional(v.array(v.string())),
  scope: v.optional(v.string()),
  roleId: v.optional(v.union(v.string(), v.null())),
});

const grantOut = (d: Doc<"auth_alfizGrants">) => ({
  id: d.grantId,
  subject: d.subject,
  ...(d.roleId === undefined ? {} : { roleId: d.roleId }),
  ...(d.pattern === undefined ? {} : { pattern: d.pattern }),
  scope: d.scope,
  ...(d.expiresAt === undefined ? {} : { expiresAt: d.expiresAt }),
  provenance: d.provenance as unknown,
  createdAt: d.createdAt,
});
const revokeOut = (d: Doc<"auth_alfizRevokes">) => ({
  id: d.revokeId,
  userId: d.userId,
  pattern: d.pattern,
  scope: d.scope,
  provenance: d.provenance as unknown,
  createdAt: d.createdAt,
});
const roleOut = (d: Doc<"auth_alfizRoles">) => ({
  id: d.roleId,
  name: d.name,
  ...(d.description === undefined ? {} : { description: d.description }),
  patterns: d.patterns,
  ...(d.requestable === undefined ? {} : { requestable: d.requestable as unknown }),
});
const groupOut = (d: Doc<"auth_alfizGroups">) => ({
  id: d.groupId,
  name: d.name,
  ...(d.description === undefined ? {} : { description: d.description }),
  parents: d.parents,
  ...(d.virtual ? { virtual: true } : {}),
});
const userOut = (d: Doc<"auth_alfizUsers">) => ({
  userId: d.userId,
  active: d.active,
  groupIds: d.groupIds,
  orgIds: d.orgIds,
  managerUserId: d.managerUserId,
});
const auditOut = (d: Doc<"auth_alfizAudit">) => ({
  id: d.auditId,
  at: d.at,
  actor: d.actor,
  action: d.action,
  target: d.target,
  ...(d.detail === undefined ? {} : { detail: d.detail as unknown }),
  ...(d.prevHash === undefined ? {} : { prevHash: d.prevHash }),
  ...(d.hash === undefined ? {} : { hash: d.hash }),
});

type GrantFilterArg = {
  subject?: string;
  subjects?: string[];
  scope?: string;
  roleId?: string | null;
};

/** Grants matching a filter; `null` when the filter is contradictory (provably empty). */
async function grantsMatching(
  ctx: QueryCtx | MutationCtx,
  filter: GrantFilterArg | undefined,
): Promise<Doc<"auth_alfizGrants">[] | null> {
  let subjects: string[] | null = null;
  if (filter?.subject !== undefined && filter.subjects !== undefined) {
    if (!filter.subjects.includes(filter.subject)) return null;
    subjects = [filter.subject];
  } else if (filter?.subject !== undefined) {
    subjects = [filter.subject];
  } else if (filter?.subjects !== undefined) {
    if (filter.subjects.length === 0) return null;
    subjects = [...new Set(filter.subjects)];
  }
  if (filter?.roleId !== undefined && typeof filter.roleId !== "string") return null;

  let rows: Doc<"auth_alfizGrants">[];
  if (subjects !== null) {
    rows = [];
    for (const subject of subjects) {
      rows.push(
        ...(await ctx.db
          .query("auth_alfizGrants")
          .withIndex("by_subject", (q) => q.eq("subject", subject))
          .collect()),
      );
    }
  } else if (filter?.scope !== undefined) {
    const scope = filter.scope;
    rows = await ctx.db
      .query("auth_alfizGrants")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .collect();
  } else if (typeof filter?.roleId === "string") {
    const roleId = filter.roleId;
    rows = await ctx.db
      .query("auth_alfizGrants")
      .withIndex("by_roleId", (q) => q.eq("roleId", roleId))
      .collect();
  } else {
    rows = await ctx.db.query("auth_alfizGrants").collect();
  }
  return rows
    .filter((r) => filter?.scope === undefined || r.scope === filter.scope)
    .filter((r) => filter?.roleId === undefined || r.roleId === filter.roleId)
    .sort((a, b) => a.createdAt - b.createdAt || (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0));
}

// -- grants -------------------------------------------------------------------
export const insertGrant = internalMutation({
  args: { row: grantRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("auth_alfizGrants")
      .withIndex("by_grantId", (q) => q.eq("grantId", row.id))
      .unique();
    if (existing) throw new Error(`alfiz: a grant with id ${JSON.stringify(row.id)} already exists`);
    await ctx.db.insert("auth_alfizGrants", {
      grantId: row.id,
      subject: row.subject,
      ...(row.roleId === undefined ? {} : { roleId: row.roleId }),
      ...(row.pattern === undefined ? {} : { pattern: row.pattern }),
      scope: row.scope,
      ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
      provenance: row.provenance,
      createdAt: row.createdAt,
    });
  },
});

export const deleteGrant = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const existing = await ctx.db
      .query("auth_alfizGrants")
      .withIndex("by_grantId", (q) => q.eq("grantId", id))
      .unique();
    if (!existing) return null;
    await ctx.db.delete(existing._id);
    return grantOut(existing);
  },
});

export const listGrants = internalQuery({
  args: { filter: v.optional(grantFilter) },
  handler: async (ctx, { filter }) => {
    const rows = await grantsMatching(ctx, filter);
    return rows === null ? [] : rows.map(grantOut);
  },
});

export const countGrants = internalQuery({
  args: { filter: v.optional(grantFilter) },
  handler: async (ctx, { filter }) => {
    const rows = await grantsMatching(ctx, filter);
    return rows === null ? 0 : rows.length;
  },
});

/** Every grant at any of `scopes` — the tenant's whole grant table in one read. */
export const listGrantsInScopes = internalQuery({
  args: { scopes: v.array(v.string()) },
  handler: async (ctx, { scopes }) => {
    const out: Doc<"auth_alfizGrants">[] = [];
    for (const scope of new Set(scopes)) {
      out.push(
        ...(await ctx.db
          .query("auth_alfizGrants")
          .withIndex("by_scope", (q) => q.eq("scope", scope))
          .collect()),
      );
    }
    return out.sort((a, b) => a.createdAt - b.createdAt).map(grantOut);
  },
});

// -- revokes ------------------------------------------------------------------
export const insertRevoke = internalMutation({
  args: { row: revokeRow },
  handler: async (ctx, { row }) => {
    const existing = await ctx.db
      .query("auth_alfizRevokes")
      .withIndex("by_revokeId", (q) => q.eq("revokeId", row.id))
      .unique();
    if (existing) throw new Error(`alfiz: a revoke with id ${JSON.stringify(row.id)} already exists`);
    await ctx.db.insert("auth_alfizRevokes", {
      revokeId: row.id,
      userId: row.userId,
      pattern: row.pattern,
      scope: row.scope,
      provenance: row.provenance,
      createdAt: row.createdAt,
    });
  },
});

export const deleteRevoke = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const existing = await ctx.db
      .query("auth_alfizRevokes")
      .withIndex("by_revokeId", (q) => q.eq("revokeId", id))
      .unique();
    if (!existing) return null;
    await ctx.db.delete(existing._id);
    return revokeOut(existing);
  },
});

export const listRevokes = internalQuery({
  args: { filter: v.optional(v.object({ userId: v.optional(v.string()), scope: v.optional(v.string()) })) },
  handler: async (ctx, { filter }) => {
    let rows: Doc<"auth_alfizRevokes">[];
    if (filter?.userId !== undefined) {
      const userId = filter.userId;
      rows = await ctx.db
        .query("auth_alfizRevokes")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();
    } else if (filter?.scope !== undefined) {
      const scope = filter.scope;
      rows = await ctx.db
        .query("auth_alfizRevokes")
        .withIndex("by_scope", (q) => q.eq("scope", scope))
        .collect();
    } else {
      rows = await ctx.db.query("auth_alfizRevokes").collect();
    }
    return rows
      .filter((r) => filter?.scope === undefined || r.scope === filter.scope)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(revokeOut);
  },
});

// -- roles --------------------------------------------------------------------
export const upsertRole = internalMutation({
  args: { role: roleRow },
  handler: async (ctx, { role }) => {
    const existing = await ctx.db
      .query("auth_alfizRoles")
      .withIndex("by_roleId", (q) => q.eq("roleId", role.id))
      .unique();
    const doc = {
      roleId: role.id,
      name: role.name,
      ...(role.description === undefined ? {} : { description: role.description }),
      patterns: role.patterns,
      ...(role.requestable === undefined ? {} : { requestable: role.requestable }),
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizRoles", doc);
  },
});

export const getRole = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("auth_alfizRoles")
      .withIndex("by_roleId", (q) => q.eq("roleId", id))
      .unique();
    return row ? roleOut(row) : null;
  },
});

export const getRoles = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const out = [];
    for (const id of new Set(ids)) {
      const row = await ctx.db
        .query("auth_alfizRoles")
        .withIndex("by_roleId", (q) => q.eq("roleId", id))
        .unique();
      if (row) out.push(roleOut(row));
    }
    return out;
  },
});

export const listRoles = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("auth_alfizRoles").collect()).map(roleOut),
});

export const deleteRole = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("auth_alfizRoles")
      .withIndex("by_roleId", (q) => q.eq("roleId", id))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// -- groups -------------------------------------------------------------------
export const upsertGroup = internalMutation({
  args: { group: groupRow },
  handler: async (ctx, { group }) => {
    const existing = await ctx.db
      .query("auth_alfizGroups")
      .withIndex("by_groupId", (q) => q.eq("groupId", group.id))
      .unique();
    const doc = {
      groupId: group.id,
      name: group.name,
      ...(group.description === undefined ? {} : { description: group.description }),
      parents: group.parents,
      virtual: group.virtual ?? false,
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizGroups", doc);
  },
});

export const getGroup = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("auth_alfizGroups")
      .withIndex("by_groupId", (q) => q.eq("groupId", id))
      .unique();
    return row ? groupOut(row) : null;
  },
});

export const listGroups = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("auth_alfizGroups").collect()).map(groupOut),
});

export const deleteGroup = internalMutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const memberships = await ctx.db
      .query("auth_alfizMemberships")
      .withIndex("by_groupId", (q) => q.eq("groupId", id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    const row = await ctx.db
      .query("auth_alfizGroups")
      .withIndex("by_groupId", (q) => q.eq("groupId", id))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// -- users --------------------------------------------------------------------
export const getUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("auth_alfizUsers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return row ? userOut(row) : null;
  },
});

export const upsertUser = internalMutation({
  args: { user: userRow },
  handler: async (ctx, { user }) => {
    const existing = await ctx.db
      .query("auth_alfizUsers")
      .withIndex("by_userId", (q) => q.eq("userId", user.userId))
      .unique();
    const doc = {
      userId: user.userId,
      active: user.active,
      groupIds: [...new Set(user.groupIds)],
      orgIds: [...new Set(user.orgIds)],
      managerUserId: user.managerUserId,
    };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizUsers", doc);
    // Reconcile the membership edge table so listUsersInGroup is one index read.
    const current = await ctx.db
      .query("auth_alfizMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", user.userId))
      .collect();
    const want = new Set(doc.groupIds);
    for (const m of current) {
      if (!want.has(m.groupId)) await ctx.db.delete(m._id);
      else want.delete(m.groupId);
    }
    for (const groupId of want) await ctx.db.insert("auth_alfizMemberships", { userId: user.userId, groupId });
  },
});

export const deleteUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const memberships = await ctx.db
      .query("auth_alfizMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);
    const row = await ctx.db
      .query("auth_alfizUsers")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

export const listUsers = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("auth_alfizUsers").collect()).map(userOut),
});

export const listUsersInGroup = internalQuery({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) =>
    (
      await ctx.db
        .query("auth_alfizMemberships")
        .withIndex("by_groupId", (q) => q.eq("groupId", groupId))
        .collect()
    )
      .map((m) => m.userId)
      .sort(),
});

// -- requests -----------------------------------------------------------------
export const insertRequest = internalMutation({
  args: { request: v.any() },
  handler: async (ctx, { request }) => {
    const r = request as { id: string; requesterUserId: string; state: string; createdAt: number };
    const existing = await ctx.db
      .query("auth_alfizRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", r.id))
      .unique();
    if (existing) throw new Error(`alfiz: a request with id ${JSON.stringify(r.id)} already exists`);
    await ctx.db.insert("auth_alfizRequests", {
      requestId: r.id,
      requesterUserId: r.requesterUserId,
      state: r.state,
      payload: request,
      createdAt: r.createdAt,
    });
  },
});

export const updateRequest = internalMutation({
  args: { request: v.any() },
  handler: async (ctx, { request }) => {
    const r = request as { id: string; requesterUserId: string; state: string; createdAt: number };
    const doc = {
      requestId: r.id,
      requesterUserId: r.requesterUserId,
      state: r.state,
      payload: request,
      createdAt: r.createdAt,
    };
    const existing = await ctx.db
      .query("auth_alfizRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", r.id))
      .unique();
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizRequests", doc);
  },
});

export const getRequest = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const row = await ctx.db
      .query("auth_alfizRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", id))
      .unique();
    return row ? (row.payload as unknown) : null;
  },
});

export const listRequests = internalQuery({
  args: { filter: v.optional(v.object({ state: v.optional(v.string()), requesterUserId: v.optional(v.string()) })) },
  handler: async (ctx, { filter }) => {
    let rows: Doc<"auth_alfizRequests">[];
    if (filter?.state !== undefined) {
      const state = filter.state;
      rows = await ctx.db
        .query("auth_alfizRequests")
        .withIndex("by_state", (q) => q.eq("state", state))
        .collect();
    } else if (filter?.requesterUserId !== undefined) {
      const requester = filter.requesterUserId;
      rows = await ctx.db
        .query("auth_alfizRequests")
        .withIndex("by_requester", (q) => q.eq("requesterUserId", requester))
        .collect();
    } else {
      rows = await ctx.db.query("auth_alfizRequests").withIndex("by_createdAt").collect();
    }
    return rows
      .filter((r) => filter?.requesterUserId === undefined || r.requesterUserId === filter.requesterUserId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => r.payload as unknown);
  },
});

// -- catalog & imports --------------------------------------------------------
export const putCatalog = internalMutation({
  args: { version: v.number(), document: v.any(), publishedAt: v.optional(v.number()) },
  handler: async (ctx, { version, document, publishedAt }) => {
    const existing = await ctx.db
      .query("auth_alfizCatalog")
      .withIndex("by_version", (q) => q.eq("version", version))
      .unique();
    const doc = { version, document, publishedAt: publishedAt ?? 0 };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizCatalog", doc);
  },
});

export const getCatalog = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("auth_alfizCatalog").withIndex("by_version").order("desc").first();
    return row ? { version: row.version, document: row.document as unknown } : null;
  },
});

export const getCatalogVersion = internalQuery({
  args: { version: v.number() },
  handler: async (ctx, { version }) => {
    const row = await ctx.db
      .query("auth_alfizCatalog")
      .withIndex("by_version", (q) => q.eq("version", version))
      .unique();
    return row ? { version: row.version, document: row.document as unknown, publishedAt: row.publishedAt } : null;
  },
});

export const listCatalogVersions = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("auth_alfizCatalog").withIndex("by_version").order("asc").collect()).map((r) => ({
      version: r.version,
      publishedAt: r.publishedAt,
    })),
});

export const putImports = internalMutation({
  args: { version: v.number(), manifest: v.any() },
  handler: async (ctx, { version, manifest }) => {
    const existing = await ctx.db
      .query("auth_alfizImports")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const doc = { key: "singleton" as const, version, manifest };
    if (existing) await ctx.db.replace(existing._id, doc);
    else await ctx.db.insert("auth_alfizImports", doc);
  },
});

export const getImports = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("auth_alfizImports")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row ? { version: row.version, manifest: row.manifest as unknown } : null;
  },
});

// -- audit --------------------------------------------------------------------
export const appendAudit = internalMutation({
  args: { event: auditRow },
  handler: async (ctx, { event }) => {
    await ctx.db.insert("auth_alfizAudit", {
      auditId: event.id,
      at: event.at,
      actor: event.actor,
      action: event.action,
      target: event.target,
      ...(event.detail === undefined || event.detail === null ? {} : { detail: event.detail }),
      ...(event.prevHash === undefined ? {} : { prevHash: event.prevHash }),
      ...(event.hash === undefined ? {} : { hash: event.hash }),
    });
  },
});

const auditFilter = v.object({
  target: v.optional(v.string()),
  actor: v.optional(v.string()),
  action: v.optional(v.string()),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
  cursor: v.optional(v.object({ at: v.number(), id: v.string() })),
  limit: v.optional(v.number()),
});

export const listAudit = internalQuery({
  args: { filter: v.optional(auditFilter) },
  handler: async (ctx, { filter }) => {
    for (const field of ["from", "to"] as const) {
      const value = filter?.[field];
      if (value !== undefined && !Number.isSafeInteger(value)) {
        throw new TypeError(
          `alfiz: listAudit ${field} must be an integer epoch-millisecond value, received ${JSON.stringify(value)}`,
        );
      }
    }
    const limit = filter?.limit;
    if (limit !== undefined && limit <= 0) return [];
    const byKey = (a: Doc<"auth_alfizAudit">, b: Doc<"auth_alfizAudit">) =>
      a.at - b.at || (a.auditId < b.auditId ? -1 : a.auditId > b.auditId ? 1 : 0);
    // Pick the most selective index; range on `at` inside it.
    let rows: Doc<"auth_alfizAudit">[];
    const from = filter?.from;
    const to = filter?.to;
    const range = (q: IndexRangeBuilder<Doc<"auth_alfizAudit">, any, any>): IndexRange => {
      if (from !== undefined && to !== undefined) return q.gte("at", from).lt("at", to);
      if (from !== undefined) return q.gte("at", from);
      if (to !== undefined) return q.lt("at", to);
      return q;
    };
    if (filter?.target !== undefined) {
      const target = filter.target;
      rows = await ctx.db
        .query("auth_alfizAudit")
        .withIndex("by_target", (q) => range(q.eq("target", target)))
        .collect();
    } else if (filter?.actor !== undefined) {
      const actor = filter.actor;
      rows = await ctx.db
        .query("auth_alfizAudit")
        .withIndex("by_actor", (q) => range(q.eq("actor", actor)))
        .collect();
    } else if (filter?.action !== undefined) {
      const action = filter.action;
      rows = await ctx.db
        .query("auth_alfizAudit")
        .withIndex("by_action", (q) => range(q.eq("action", action)))
        .collect();
    } else {
      rows = await ctx.db
        .query("auth_alfizAudit")
        .withIndex("by_at", (q) => range(q))
        .collect();
    }
    rows = rows
      .filter((e) => filter?.target === undefined || e.target === filter.target)
      .filter((e) => filter?.actor === undefined || e.actor === filter.actor)
      .filter((e) => filter?.action === undefined || e.action === filter.action)
      .sort(byKey);
    const cursor = filter?.cursor;
    if (cursor !== undefined) {
      rows = rows.filter((e) => e.at > cursor.at || (e.at === cursor.at && e.auditId > cursor.id));
      return rows.slice(0, limit ?? rows.length).map(auditOut);
    }
    return rows.slice(-(limit ?? rows.length)).map(auditOut);
  },
});

// -- invalidation events (the epoch) -----------------------------------------
async function epochRow(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("auth_alfizEpoch")
    .withIndex("by_key", (q) => q.eq("key", "singleton"))
    .unique();
  if (existing) return existing;
  const id = await ctx.db.insert("auth_alfizEpoch", { key: "singleton", seq: 0, prunedThrough: 0 });
  const created = await ctx.db.get(id);
  if (!created) throw new Error("alfiz: could not create the epoch row");
  return created;
}

export const appendEvents = internalMutation({
  args: { events: v.array(v.any()), at: v.number() },
  handler: async (ctx, { events, at }) => {
    const epoch = await epochRow(ctx);
    const upTo = epoch.seq + events.length;
    await ctx.db.patch(epoch._id, { seq: upTo });
    for (const [index, event] of events.entries()) {
      const e = event as { type: string };
      await ctx.db.insert("auth_alfizEvents", { seq: epoch.seq + index + 1, type: e.type, payload: event, at });
    }
    return { upTo };
  },
});

export const headSeq = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("auth_alfizEpoch")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return row?.seq ?? 0;
  },
});

export const eventsSince = internalQuery({
  args: { seq: v.number(), limit: v.number() },
  handler: async (ctx, { seq, limit }) => {
    const head = await ctx.db
      .query("auth_alfizEpoch")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!head) return { upTo: seq, events: [] as unknown[] };
    if (seq < head.prunedThrough) return { gap: true as const };
    const take = Math.max(0, Math.trunc(limit)) || 1000;
    const rows = await ctx.db
      .query("auth_alfizEvents")
      .withIndex("by_seq", (q) => q.gt("seq", seq))
      .order("asc")
      .take(take);
    const contiguous: typeof rows = [];
    let expected = seq + 1;
    for (const row of rows) {
      if (row.seq !== expected) break;
      contiguous.push(row);
      expected += 1;
    }
    const last = contiguous[contiguous.length - 1];
    return { upTo: last ? last.seq : seq, events: contiguous.map((r) => r.payload as unknown) };
  },
});

export const pruneEvents = internalMutation({
  args: { cutoff: v.object({ at: v.optional(v.number()), keepRows: v.optional(v.number()) }) },
  handler: async (ctx, { cutoff }) => {
    const head = await ctx.db
      .query("auth_alfizEpoch")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (!head) return 0;
    let pruneUpTo = head.prunedThrough;
    if (cutoff.at !== undefined) {
      const at = cutoff.at;
      const older = await ctx.db
        .query("auth_alfizEvents")
        .withIndex("by_at", (q) => q.lt("at", at))
        .collect();
      for (const e of older) if (e.seq > pruneUpTo) pruneUpTo = e.seq;
    }
    if (cutoff.keepRows !== undefined) {
      const bySize = head.seq - cutoff.keepRows;
      if (bySize > pruneUpTo) pruneUpTo = bySize;
    }
    if (pruneUpTo <= head.prunedThrough) return 0;
    const doomed = await ctx.db
      .query("auth_alfizEvents")
      .withIndex("by_seq", (q) => q.lte("seq", pruneUpTo))
      .collect();
    for (const e of doomed) await ctx.db.delete(e._id);
    await ctx.db.patch(head._id, { prunedThrough: pruneUpTo });
    return doomed.length;
  },
});
