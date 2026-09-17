/**
 * The AuthStore over Convex: a thin adapter from the store seam to the
 * internal functions in convex/. Nothing here interprets data.
 */
import type { GrantFilter, StorageDriver } from "@alfiz/application";
import type { GrantRow } from "@alfiz/core";
import { internal } from "../../convex/_generated/api";
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

    insertGrant: (row) => voided(c.mutation(internal.alfiz.insertGrant, { row: compact(row) })),
    deleteGrant: (id) => c.mutation(internal.alfiz.deleteGrant, { id }) as Promise<GrantRow | null>,
    listGrants: (filter) =>
      c.query(internal.alfiz.listGrants, withFilter(grantFilterArgs(filter))) as Promise<GrantRow[]>,
    countGrants: (filter) => c.query(internal.alfiz.countGrants, withFilter(grantFilterArgs(filter))),

    insertRevoke: (row) => voided(c.mutation(internal.alfiz.insertRevoke, { row: compact(row) })),
    deleteRevoke: (id) => c.mutation(internal.alfiz.deleteRevoke, { id }) as never,
    listRevokes: (filter) => c.query(internal.alfiz.listRevokes, withFilter(filter)) as never,

    upsertRole: (role) => voided(c.mutation(internal.alfiz.upsertRole, { role: compact(role) })),
    getRole: (id) => c.query(internal.alfiz.getRole, { id }) as never,
    getRoles: (ids) => c.query(internal.alfiz.getRoles, { ids: [...ids] }) as never,
    listRoles: () => c.query(internal.alfiz.listRoles, {}) as never,
    deleteRole: (id) => voided(c.mutation(internal.alfiz.deleteRole, { id })),

    upsertGroup: (group) => voided(c.mutation(internal.alfiz.upsertGroup, { group: compact(group) })),
    getGroup: (id) => c.query(internal.alfiz.getGroup, { id }) as never,
    listGroups: () => c.query(internal.alfiz.listGroups, {}) as never,
    deleteGroup: (id) => voided(c.mutation(internal.alfiz.deleteGroup, { id })),

    getUser: (userId) => c.query(internal.alfiz.getUser, { userId }),
    upsertUser: (user) => voided(c.mutation(internal.alfiz.upsertUser, { user })),
    deleteUser: (userId) => voided(c.mutation(internal.alfiz.deleteUser, { userId })),
    listUsers: () => c.query(internal.alfiz.listUsers, {}),
    listUsersInGroup: (groupId) => c.query(internal.alfiz.listUsersInGroup, { groupId }),

    insertRequest: (request) => voided(c.mutation(internal.alfiz.insertRequest, { request })),
    updateRequest: (request) => voided(c.mutation(internal.alfiz.updateRequest, { request })),
    getRequest: (id) => c.query(internal.alfiz.getRequest, { id }) as never,
    listRequests: (filter) => c.query(internal.alfiz.listRequests, withFilter(filter)) as never,

    putCatalog: (version, document, publishedAt) =>
      voided(c.mutation(internal.alfiz.putCatalog, compact({ version, document, publishedAt }))),
    getCatalog: () => c.query(internal.alfiz.getCatalog, {}) as never,
    getCatalogVersion: (version) => c.query(internal.alfiz.getCatalogVersion, { version }) as never,
    listCatalogVersions: () => c.query(internal.alfiz.listCatalogVersions, {}),
    putImports: (version, manifest) => voided(c.mutation(internal.alfiz.putImports, { version, manifest })),
    getImports: () => c.query(internal.alfiz.getImports, {}) as never,

    appendAudit: (event) => voided(c.mutation(internal.alfiz.appendAudit, { event: compact(event) })),
    listAudit: (filter) => c.query(internal.alfiz.listAudit, withFilter(filter)) as never,

    appendEvents: (events, at) => c.mutation(internal.alfiz.appendEvents, { events: [...events], at }),
    headSeq: () => c.query(internal.alfiz.headSeq, {}),
    eventsSince: (seq, limit) => c.query(internal.alfiz.eventsSince, { seq, limit: limit ?? EVENTS_LIMIT }) as never,
    pruneEvents: (cutoff) => c.mutation(internal.alfiz.pruneEvents, { cutoff: compact(cutoff) }),

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
    getTenant: (tenantId) => c.query(internal.tenancy.getTenant, { tenantId }),
    insertTenant: (tenant) => c.mutation(internal.tenancy.insertTenant, { tenant }),
    updateTenantVocabulary: (tenantId, environments, projectDefaults) =>
      voided(c.mutation(internal.tenancy.updateTenantVocabulary, { tenantId, environments, projectDefaults })),
    listProjects: (tenantId) => c.query(internal.tenancy.listProjects, { tenantId }),
    getProject: (tenantId, projectId) => c.query(internal.tenancy.getProject, { tenantId, projectId }),
    getProjectById: (projectId) => c.query(internal.tenancy.getProjectById, { projectId }),
    getProjectBySlug: (tenantId, slug) => c.query(internal.tenancy.getProjectBySlug, { tenantId, slug }),
    insertProject: (project, environments) => c.mutation(internal.tenancy.insertProject, { project, environments }),
    updateProject: (tenantId, projectId, patch) =>
      voided(
        c.mutation(
          internal.tenancy.updateProject,
          compact({ tenantId, projectId, name: patch.name, archivedAt: patch.archivedAt }),
        ),
      ),
    deleteProject: (tenantId, projectId) => voided(c.mutation(internal.tenancy.deleteProject, { tenantId, projectId })),
    listEnvironments: (tenantId, projectId) => c.query(internal.tenancy.listEnvironments, { tenantId, projectId }),
    listTenantEnvironments: (tenantId) => c.query(internal.tenancy.listTenantEnvironments, { tenantId }),
    getEnvironment: (tenantId, environmentId) => c.query(internal.tenancy.getEnvironment, { tenantId, environmentId }),
    getEnvironmentById: (environmentId) => c.query(internal.tenancy.getEnvironmentById, { environmentId }),
    insertEnvironment: (environment) => c.mutation(internal.tenancy.insertEnvironment, { environment }),
    recordAudit: (entry) => voided(c.mutation(internal.tenancy.recordAudit, { entry: compact(entry) })),
    listTenantAudit: (tenantId, limit) => c.query(internal.tenancy.listTenantAudit, { tenantId, limit }) as never,
  };
}

export function convexStore(caller: ConvexCaller): AuthStore {
  return {
    alfiz: alfizDriver(caller),
    tenancy: tenancyStore(caller),
    listGrantsInScopes: (scopes) => caller.query(internal.alfiz.listGrantsInScopes, { scopes }) as Promise<GrantRow[]>,
  };
}
