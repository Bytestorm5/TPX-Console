/**
 * Tenancy rows: tenants (one per Clerk organization), projects, environments
 * and the tenant audit log. Every read is scoped by tenantId; the two id-only
 * lookups exist for the ancestry resolver and are never exposed to callers.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const tenantRow = v.object({
  id: v.string(),
  name: v.string(),
  environments: v.array(v.string()),
  projectDefaults: v.array(v.string()),
  createdBy: v.string(),
  createdAt: v.number(),
});
const projectRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  slug: v.string(),
  name: v.string(),
  createdAt: v.number(),
  archivedAt: v.union(v.number(), v.null()),
});
const environmentRow = v.object({
  id: v.string(),
  tenantId: v.string(),
  projectId: v.string(),
  name: v.string(),
  createdAt: v.number(),
});

const tenantOut = (d: Doc<"tenants">) => ({
  id: d.tenantId,
  name: d.name,
  environments: d.environments,
  projectDefaults: d.projectDefaults,
  createdBy: d.createdBy,
  createdAt: d.createdAt,
});
const projectOut = (d: Doc<"projects">) => ({
  id: d.projectId,
  tenantId: d.tenantId,
  slug: d.slug,
  name: d.name,
  createdAt: d.createdAt,
  archivedAt: d.archivedAt,
});
const environmentOut = (d: Doc<"environments">) => ({
  id: d.environmentId,
  tenantId: d.tenantId,
  projectId: d.projectId,
  name: d.name,
  createdAt: d.createdAt,
});

export const getTenant = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => {
    const row = await ctx.db
      .query("tenants")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .unique();
    return row ? tenantOut(row) : null;
  },
});

/** Returns false when the tenant already existed. */
export const insertTenant = internalMutation({
  args: { tenant: tenantRow },
  handler: async (ctx, { tenant }) => {
    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenant.id))
      .unique();
    if (existing) return false;
    await ctx.db.insert("tenants", {
      tenantId: tenant.id,
      name: tenant.name,
      environments: tenant.environments,
      projectDefaults: tenant.projectDefaults,
      createdBy: tenant.createdBy,
      createdAt: tenant.createdAt,
    });
    return true;
  },
});

export const updateTenantVocabulary = internalMutation({
  args: { tenantId: v.string(), environments: v.array(v.string()), projectDefaults: v.array(v.string()) },
  handler: async (ctx, { tenantId, environments, projectDefaults }) => {
    const row = await ctx.db
      .query("tenants")
      .withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
      .unique();
    if (!row) throw new Error("tenant not found");
    await ctx.db.patch(row._id, { environments, projectDefaults });
  },
});

export const listProjects = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    (
      await ctx.db
        .query("projects")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .order("asc")
        .collect()
    ).map(projectOut),
});

export const getProject = internalQuery({
  args: { tenantId: v.string(), projectId: v.string() },
  handler: async (ctx, { tenantId, projectId }) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    return row && row.tenantId === tenantId ? projectOut(row) : null;
  },
});

export const getProjectById = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    return row ? projectOut(row) : null;
  },
});

export const getProjectBySlug = internalQuery({
  args: { tenantId: v.string(), slug: v.string() },
  handler: async (ctx, { tenantId, slug }) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_tenant_slug", (q) => q.eq("tenantId", tenantId).eq("slug", slug))
      .unique();
    return row ? projectOut(row) : null;
  },
});

/** Inserts the project and its environments atomically; false when the slug is taken. */
export const insertProject = internalMutation({
  args: { project: projectRow, environments: v.array(environmentRow) },
  handler: async (ctx, { project, environments }) => {
    const clash = await ctx.db
      .query("projects")
      .withIndex("by_tenant_slug", (q) => q.eq("tenantId", project.tenantId).eq("slug", project.slug))
      .unique();
    if (clash) return false;
    await ctx.db.insert("projects", {
      projectId: project.id,
      tenantId: project.tenantId,
      slug: project.slug,
      name: project.name,
      createdAt: project.createdAt,
      archivedAt: project.archivedAt,
    });
    for (const e of environments) {
      await ctx.db.insert("environments", {
        environmentId: e.id,
        tenantId: e.tenantId,
        projectId: e.projectId,
        name: e.name,
        createdAt: e.createdAt,
      });
    }
    return true;
  },
});

export const updateProject = internalMutation({
  args: {
    tenantId: v.string(),
    projectId: v.string(),
    name: v.optional(v.string()),
    archivedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { tenantId, projectId, name, archivedAt }) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (!row || row.tenantId !== tenantId) throw new Error("project not found");
    await ctx.db.patch(row._id, {
      ...(name === undefined ? {} : { name }),
      ...(archivedAt === undefined ? {} : { archivedAt }),
    });
  },
});

export const deleteProject = internalMutation({
  args: { tenantId: v.string(), projectId: v.string() },
  handler: async (ctx, { tenantId, projectId }) => {
    const row = await ctx.db
      .query("projects")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (!row || row.tenantId !== tenantId) return;
    const envs = await ctx.db
      .query("environments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const e of envs) await ctx.db.delete(e._id);
    await ctx.db.delete(row._id);
  },
});

export const listEnvironments = internalQuery({
  args: { tenantId: v.string(), projectId: v.string() },
  handler: async (ctx, { tenantId, projectId }) =>
    (
      await ctx.db
        .query("environments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("asc")
        .collect()
    )
      .filter((e) => e.tenantId === tenantId)
      .map(environmentOut),
});

export const listTenantEnvironments = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) =>
    (
      await ctx.db
        .query("environments")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .order("asc")
        .collect()
    ).map(environmentOut),
});

export const getEnvironment = internalQuery({
  args: { tenantId: v.string(), environmentId: v.string() },
  handler: async (ctx, { tenantId, environmentId }) => {
    const row = await ctx.db
      .query("environments")
      .withIndex("by_environmentId", (q) => q.eq("environmentId", environmentId))
      .unique();
    return row && row.tenantId === tenantId ? environmentOut(row) : null;
  },
});

export const getEnvironmentById = internalQuery({
  args: { environmentId: v.string() },
  handler: async (ctx, { environmentId }) => {
    const row = await ctx.db
      .query("environments")
      .withIndex("by_environmentId", (q) => q.eq("environmentId", environmentId))
      .unique();
    return row ? environmentOut(row) : null;
  },
});

/** False when the project already has an environment of that name. */
export const insertEnvironment = internalMutation({
  args: { environment: environmentRow },
  handler: async (ctx, { environment }) => {
    const clash = await ctx.db
      .query("environments")
      .withIndex("by_project_name", (q) => q.eq("projectId", environment.projectId).eq("name", environment.name))
      .unique();
    if (clash) return false;
    await ctx.db.insert("environments", {
      environmentId: environment.id,
      tenantId: environment.tenantId,
      projectId: environment.projectId,
      name: environment.name,
      createdAt: environment.createdAt,
    });
    return true;
  },
});

export const recordAudit = internalMutation({
  args: {
    entry: v.object({
      id: v.string(),
      tenantId: v.string(),
      at: v.number(),
      actor: v.string(),
      action: v.string(),
      target: v.string(),
      detail: v.optional(v.any()),
    }),
  },
  handler: async (ctx, { entry }) => {
    await ctx.db.insert("tenantAudit", {
      auditId: entry.id,
      tenantId: entry.tenantId,
      at: entry.at,
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    });
  },
});

/** The last `limit` entries for a tenant, newest first. */
export const listTenantAudit = internalQuery({
  args: { tenantId: v.string(), limit: v.number() },
  handler: async (ctx, { tenantId, limit }) =>
    (
      await ctx.db
        .query("tenantAudit")
        .withIndex("by_tenant_at", (q) => q.eq("tenantId", tenantId))
        .order("desc")
        .take(Math.max(1, limit))
    ).map((d) => ({
      id: d.auditId,
      at: d.at,
      actor: d.actor,
      action: d.action,
      target: d.target,
      ...(d.detail === undefined ? {} : { detail: d.detail as unknown }),
    })),
});
