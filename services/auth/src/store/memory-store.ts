/** The in-memory AuthStore: Alfiz's reference driver plus maps for tenancy. Tests only. */
import { memoryDriver } from "@alfiz/application";
import type { AuditEntry, Environment, Project, Tenant } from "@tpx/contracts/auth";
import type { AuthStore, TenancyStore } from "./types.ts";

const clone = <T>(v: T): T => structuredClone(v);

export function memoryStore(): AuthStore {
  const alfiz = memoryDriver();
  const tenants = new Map<string, Tenant>();
  const projects = new Map<string, Project>();
  const environments = new Map<string, Environment>();
  const audit: Array<AuditEntry & { tenantId: string }> = [];

  const tenancy: TenancyStore = {
    async getTenant(tenantId) {
      const t = tenants.get(tenantId);
      return t ? clone(t) : null;
    },
    async insertTenant(tenant) {
      if (tenants.has(tenant.id)) return false;
      tenants.set(tenant.id, clone(tenant));
      return true;
    },
    async updateTenantVocabulary(tenantId, envs, defaults) {
      const t = tenants.get(tenantId);
      if (!t) throw new Error("tenant not found");
      tenants.set(tenantId, { ...t, environments: [...envs], projectDefaults: [...defaults] });
    },
    async listProjects(tenantId) {
      return [...projects.values()]
        .filter((p) => p.tenantId === tenantId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async getProject(tenantId, projectId) {
      const p = projects.get(projectId);
      return p && p.tenantId === tenantId ? clone(p) : null;
    },
    async getProjectById(projectId) {
      const p = projects.get(projectId);
      return p ? clone(p) : null;
    },
    async getProjectBySlug(tenantId, slug) {
      const p = [...projects.values()].find((x) => x.tenantId === tenantId && x.slug === slug);
      return p ? clone(p) : null;
    },
    async insertProject(project, envs) {
      if ([...projects.values()].some((x) => x.tenantId === project.tenantId && x.slug === project.slug)) return false;
      projects.set(project.id, clone(project));
      for (const e of envs) environments.set(e.id, clone(e));
      return true;
    },
    async updateProject(tenantId, projectId, patch) {
      const p = projects.get(projectId);
      if (!p || p.tenantId !== tenantId) throw new Error("project not found");
      projects.set(projectId, {
        ...p,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.archivedAt === undefined ? {} : { archivedAt: patch.archivedAt }),
      });
    },
    async deleteProject(tenantId, projectId) {
      const p = projects.get(projectId);
      if (!p || p.tenantId !== tenantId) return;
      for (const [id, e] of environments) if (e.projectId === projectId) environments.delete(id);
      projects.delete(projectId);
    },
    async listEnvironments(tenantId, projectId) {
      return [...environments.values()]
        .filter((e) => e.tenantId === tenantId && e.projectId === projectId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async listTenantEnvironments(tenantId) {
      return [...environments.values()]
        .filter((e) => e.tenantId === tenantId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async getEnvironment(tenantId, environmentId) {
      const e = environments.get(environmentId);
      return e && e.tenantId === tenantId ? clone(e) : null;
    },
    async getEnvironmentById(environmentId) {
      const e = environments.get(environmentId);
      return e ? clone(e) : null;
    },
    async insertEnvironment(environment) {
      if ([...environments.values()].some((e) => e.projectId === environment.projectId && e.name === environment.name))
        return false;
      environments.set(environment.id, clone(environment));
      return true;
    },
    async recordAudit(entry) {
      audit.push(clone({ ...entry, ...(entry.detail === undefined ? {} : { detail: entry.detail }) }));
    },
    async listTenantAudit(tenantId, limit) {
      return audit
        .filter((a) => a.tenantId === tenantId)
        .sort((a, b) => b.at - a.at || (b.id < a.id ? -1 : 1))
        .slice(0, limit)
        .map(({ tenantId: _t, ...rest }) => clone(rest));
    },
  };

  return {
    alfiz,
    tenancy,
    async listGrantsInScopes(scopes) {
      const wanted = new Set(scopes);
      return (await alfiz.listGrants()).filter((g) => wanted.has(g.scope));
    },
  };
}
