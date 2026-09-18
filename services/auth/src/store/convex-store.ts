/**
 * The AuthStore over Convex: a thin adapter from the store seam to the
 * internal functions in convex/. Nothing here interprets data.
 */
import type { GrantFilter, StorageDriver } from "@alfiz/application";
import type { GrantRow } from "@alfiz/core";
import { internal } from "@tpx/convex/api";
import { compact, voided, type ConvexCaller } from "@tpx/convex-client";
import type { AuthStore, TenancyStore } from "./types.ts";

const EVENTS_LIMIT = 1000;

/** `{ filter }` only when there is one: Convex validators reject an explicit `undefined`. */
const withFilter = <T extends object>(filter: T | undefined) =>
  filter === undefined ? {} : { filter: compact(filter) };

/** Alfiz filters carry readonly arrays; Convex validators want mutable ones. */
const grantFilterArgs = (filter: GrantFilter | undefined) =>
  filter === undefined
    ? undefined
    : {
        subject: filter.subject,
        subjects: filter.subjects === undefined ? undefined : [...filter.subjects],
        scope: filter.scope,
        roleId: filter.roleId,
      };

function alfizDriver(c: ConvexCaller): StorageDriver {
  const locks = new Map<string, Promise<unknown>>();
  return {
    durable: true,
    driverName: "convex",
    crossProcess: false,

    insertGrant: (row) => voided(c.mutation(internal.auth.alfiz.insertGrant, { row: compact(row) })),
    deleteGrant: (id) => c.mutation(internal.auth.alfiz.deleteGrant, { id }) as Promise<GrantRow | null>,
    listGrants: (filter) =>
      c.query(internal.auth.alfiz.listGrants, withFilter(grantFilterArgs(filter))) as Promise<GrantRow[]>,
    countGrants: (filter) => c.query(internal.auth.alfiz.countGrants, withFilter(grantFilterArgs(filter))),

    insertRevoke: (row) => voided(c.mutation(internal.auth.alfiz.insertRevoke, { row: compact(row) })),
    deleteRevoke: (id) => c.mutation(internal.auth.alfiz.deleteRevoke, { id }) as never,
    listRevokes: (filter) => c.query(internal.auth.alfiz.listRevokes, withFilter(filter)) as never,

    upsertRole: (role) => voided(c.mutation(internal.auth.alfiz.upsertRole, { role: compact(role) })),
    getRole: (id) => c.query(internal.auth.alfiz.getRole, { id }) as never,
    getRoles: (ids) => c.query(internal.auth.alfiz.getRoles, { ids: [...ids] }) as never,
    listRoles: () => c.query(internal.auth.alfiz.listRoles, {}) as never,
    deleteRole: (id) => voided(c.mutation(internal.auth.alfiz.deleteRole, { id })),

    upsertGroup: (group) => voided(c.mutation(internal.auth.alfiz.upsertGroup, { group: compact(group) })),
    getGroup: (id) => c.query(internal.auth.alfiz.getGroup, { id }) as never,
    listGroups: () => c.query(internal.auth.alfiz.listGroups, {}) as never,
    deleteGroup: (id) => voided(c.mutation(internal.auth.alfiz.deleteGroup, { id })),

    getUser: (userId) => c.query(internal.auth.alfiz.getUser, { userId }),
    upsertUser: (user) => voided(c.mutation(internal.auth.alfiz.upsertUser, { user })),
    deleteUser: (userId) => voided(c.mutation(internal.auth.alfiz.deleteUser, { userId })),
    listUsers: () => c.query(internal.auth.alfiz.listUsers, {}),
    listUsersInGroup: (groupId) => c.query(internal.auth.alfiz.listUsersInGroup, { groupId }),

    insertRequest: (request) => voided(c.mutation(internal.auth.alfiz.insertRequest, { request })),
    updateRequest: (request) => voided(c.mutation(internal.auth.alfiz.updateRequest, { request })),
    getRequest: (id) => c.query(internal.auth.alfiz.getRequest, { id }) as never,
    listRequests: (filter) => c.query(internal.auth.alfiz.listRequests, withFilter(filter)) as never,

    putCatalog: (version, document, publishedAt) =>
      voided(c.mutation(internal.auth.alfiz.putCatalog, compact({ version, document, publishedAt }))),
    getCatalog: () => c.query(internal.auth.alfiz.getCatalog, {}) as never,
    getCatalogVersion: (version) => c.query(internal.auth.alfiz.getCatalogVersion, { version }) as never,
    listCatalogVersions: () => c.query(internal.auth.alfiz.listCatalogVersions, {}),
    putImports: (version, manifest) => voided(c.mutation(internal.auth.alfiz.putImports, { version, manifest })),
    getImports: () => c.query(internal.auth.alfiz.getImports, {}) as never,

    appendAudit: (event) => voided(c.mutation(internal.auth.alfiz.appendAudit, { event: compact(event) })),
    listAudit: (filter) => c.query(internal.auth.alfiz.listAudit, withFilter(filter)) as never,

    appendEvents: (events, at) => c.mutation(internal.auth.alfiz.appendEvents, { events: [...events], at }),
    headSeq: () => c.query(internal.auth.alfiz.headSeq, {}),
    eventsSince: (seq, limit) =>
      c.query(internal.auth.alfiz.eventsSince, { seq, limit: limit ?? EVENTS_LIMIT }) as never,
    pruneEvents: (cutoff) => c.mutation(internal.auth.alfiz.pruneEvents, { cutoff: compact(cutoff) }),

    async runExclusive(key, fn) {
      const previous = locks.get(key) ?? Promise.resolve();
      const next = previous.then(fn, fn);
      locks.set(
        key,
        next.catch(() => undefined),
      );
      return next;
    },
  };
}

function tenancyStore(c: ConvexCaller): TenancyStore {
  return {
    getTenant: (tenantId) => c.query(internal.auth.tenancy.getTenant, { tenantId }),
    insertTenant: (tenant) => c.mutation(internal.auth.tenancy.insertTenant, { tenant }),
    updateTenantName: (tenantId, name) =>
      voided(c.mutation(internal.auth.tenancy.updateTenantName, { tenantId, name })),
    getUser: (userId) => c.query(internal.auth.tenancy.getUser, { userId }),
    getUserByEmail: (email) => c.query(internal.auth.tenancy.getUserByEmail, { email }),
    upsertUser: (profile) => voided(c.mutation(internal.auth.tenancy.upsertUser, { profile })),
    deleteUser: (userId) => voided(c.mutation(internal.auth.tenancy.deleteUser, { userId })),
    listMemberships: (userId) => c.query(internal.auth.tenancy.listMemberships, { userId }),
    listMembers: (tenantId) => c.query(internal.auth.tenancy.listMembers, { tenantId }),
    insertMembership: (membership) => c.mutation(internal.auth.tenancy.insertMembership, { membership }),
    deleteMembership: (tenantId, userId) =>
      voided(c.mutation(internal.auth.tenancy.deleteMembership, { tenantId, userId })),
    insertInvite: (invite) => c.mutation(internal.auth.tenancy.insertInvite, { invite }),
    listInvites: (tenantId) => c.query(internal.auth.tenancy.listInvites, { tenantId }),
    listInvitesForEmail: (email) => c.query(internal.auth.tenancy.listInvitesForEmail, { email }),
    deleteInvite: (inviteId) => c.mutation(internal.auth.tenancy.deleteInvite, { inviteId }),
    updateTenantVocabulary: (tenantId, environments, projectDefaults) =>
      voided(c.mutation(internal.auth.tenancy.updateTenantVocabulary, { tenantId, environments, projectDefaults })),
    listProjects: (tenantId) => c.query(internal.auth.tenancy.listProjects, { tenantId }),
    getProject: (tenantId, projectId) => c.query(internal.auth.tenancy.getProject, { tenantId, projectId }),
    getProjectById: (projectId) => c.query(internal.auth.tenancy.getProjectById, { projectId }),
    getProjectBySlug: (tenantId, slug) => c.query(internal.auth.tenancy.getProjectBySlug, { tenantId, slug }),
    insertProject: (project, environments) =>
      c.mutation(internal.auth.tenancy.insertProject, { project, environments }),
    updateProject: (tenantId, projectId, patch) =>
      voided(
        c.mutation(
          internal.auth.tenancy.updateProject,
          compact({ tenantId, projectId, name: patch.name, archivedAt: patch.archivedAt }),
        ),
      ),
    deleteProject: (tenantId, projectId) =>
      voided(c.mutation(internal.auth.tenancy.deleteProject, { tenantId, projectId })),
    listEnvironments: (tenantId, projectId) => c.query(internal.auth.tenancy.listEnvironments, { tenantId, projectId }),
    listTenantEnvironments: (tenantId) => c.query(internal.auth.tenancy.listTenantEnvironments, { tenantId }),
    getEnvironment: (tenantId, environmentId) =>
      c.query(internal.auth.tenancy.getEnvironment, { tenantId, environmentId }),
    getEnvironmentById: (environmentId) => c.query(internal.auth.tenancy.getEnvironmentById, { environmentId }),
    insertEnvironment: (environment) => c.mutation(internal.auth.tenancy.insertEnvironment, { environment }),
    recordAudit: (entry) => voided(c.mutation(internal.auth.tenancy.recordAudit, { entry: compact(entry) })),
    listTenantAudit: (tenantId, limit) => c.query(internal.auth.tenancy.listTenantAudit, { tenantId, limit }) as never,
  };
}

export function convexStore(caller: ConvexCaller): AuthStore {
  return {
    alfiz: alfizDriver(caller),
    tenancy: tenancyStore(caller),
    listGrantsInScopes: (scopes) =>
      caller.query(internal.auth.alfiz.listGrantsInScopes, { scopes }) as Promise<GrantRow[]>,
  };
}
