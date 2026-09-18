/** The in-memory AuthStore: Alfiz's reference driver plus maps for tenancy. Tests only. */
import { memoryDriver } from "@alfiz/application";
import type { AuditEntry, Environment, Invite, Project, Tenant, UserProfile } from "@tpx/contracts/auth";
import type { AuthStore, MembershipRow, TenancyStore } from "./types.ts";

const clone = <T>(v: T): T => structuredClone(v);

export function memoryStore(): AuthStore {
  const alfiz = memoryDriver();
  const tenants = new Map<string, Tenant>();
  const projects = new Map<string, Project>();
  const environments = new Map<string, Environment>();
  const audit: Array<AuditEntry & { tenantId: string }> = [];
  const users = new Map<string, UserProfile>();
  const memberships: MembershipRow[] = [];
  const invites = new Map<string, Invite>();

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
    async updateTenantName(tenantId, name) {
      const t = tenants.get(tenantId);
      if (!t) throw new Error("tenant not found");
      tenants.set(tenantId, { ...t, name });
    },
    async getUser(userId) {
      const u = users.get(userId);
      return u ? clone(u) : null;
    },
    async getUserByEmail(email) {
      const u = [...users.values()].find((x) => x.email === email);
      return u ? clone(u) : null;
    },
    async upsertUser(profile) {
      users.set(profile.userId, clone(profile));
    },
    async deleteUser(userId) {
      users.delete(userId);
    },
    async listMemberships(userId) {
      return memberships
        .filter((m) => m.userId === userId)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(clone);
    },
    async listMembers(tenantId) {
      return memberships
        .filter((m) => m.tenantId === tenantId)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(clone);
    },
    async insertMembership(row) {
      if (memberships.some((m) => m.tenantId === row.tenantId && m.userId === row.userId)) return false;
      memberships.push(clone(row));
      return true;
    },
    async deleteMembership(tenantId, userId) {
      const index = memberships.findIndex((m) => m.tenantId === tenantId && m.userId === userId);
      if (index >= 0) memberships.splice(index, 1);
    },
    async insertInvite(invite) {
      if ([...invites.values()].some((i) => i.tenantId === invite.tenantId && i.email === invite.email)) return false;
      invites.set(invite.id, clone(invite));
      return true;
    },
    async listInvites(tenantId) {
      return [...invites.values()]
        .filter((i) => i.tenantId === tenantId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async listInvitesForEmail(email) {
      return [...invites.values()]
        .filter((i) => i.email === email)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async deleteInvite(inviteId) {
      const i = invites.get(inviteId);
      if (!i) return null;
      invites.delete(inviteId);
      return clone(i);
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
