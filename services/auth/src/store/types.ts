/**
 * The store seam of the auth service: everything the service persists,
 * behind one interface so the Worker-runtime tests run against memory and
 * production runs against Convex. The Alfiz half IS Alfiz's storage seam; the tenancy
 * half is the console's own.
 */
import type { GrantRow } from "@alfiz/core";
import type { StorageDriver } from "@alfiz/application";
import type { AuditEntry, Environment, Invite, Project, Tenant, UserProfile } from "@tpx/contracts/auth";

export interface MembershipRow {
  tenantId: string;
  userId: string;
  joinedAt: number;
  invitedBy: string | null;
}

export interface TenancyStore {
  getTenant(tenantId: string): Promise<Tenant | null>;
  /** False when the tenant already existed. */
  insertTenant(tenant: Tenant): Promise<boolean>;
  updateTenantName(tenantId: string, name: string): Promise<void>;
  updateTenantVocabulary(tenantId: string, environments: string[], projectDefaults: string[]): Promise<void>;

  getUser(userId: string): Promise<UserProfile | null>;
  getUserByEmail(email: string): Promise<UserProfile | null>;
  upsertUser(profile: UserProfile): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  listMemberships(userId: string): Promise<MembershipRow[]>;
  listMembers(tenantId: string): Promise<MembershipRow[]>;
  /** False when already a member. */
  insertMembership(row: MembershipRow): Promise<boolean>;
  deleteMembership(tenantId: string, userId: string): Promise<void>;
  /** False when the tenant already has a pending invitation for the address. */
  insertInvite(invite: Invite): Promise<boolean>;
  listInvites(tenantId: string): Promise<Invite[]>;
  listInvitesForEmail(email: string): Promise<Invite[]>;
  /** Deletes and returns the invitation, or null when it was already gone. */
  deleteInvite(inviteId: string): Promise<Invite | null>;

  listProjects(tenantId: string): Promise<Project[]>;
  getProject(tenantId: string, projectId: string): Promise<Project | null>;
  /** Ancestry only — never exposed to callers. */
  getProjectById(projectId: string): Promise<Project | null>;
  getProjectBySlug(tenantId: string, slug: string): Promise<Project | null>;
  /** Atomic; false when the slug is taken. */
  insertProject(project: Project, environments: Environment[]): Promise<boolean>;
  updateProject(
    tenantId: string,
    projectId: string,
    patch: { name?: string; archivedAt?: number | null },
  ): Promise<void>;
  deleteProject(tenantId: string, projectId: string): Promise<void>;
  listEnvironments(tenantId: string, projectId: string): Promise<Environment[]>;
  listTenantEnvironments(tenantId: string): Promise<Environment[]>;
  getEnvironment(tenantId: string, environmentId: string): Promise<Environment | null>;
  /** Ancestry only — never exposed to callers. */
  getEnvironmentById(environmentId: string): Promise<Environment | null>;
  /** False when the project already has an environment of that name. */
  insertEnvironment(environment: Environment): Promise<boolean>;
  recordAudit(entry: {
    id: string;
    tenantId: string;
    at: number;
    actor: string;
    action: string;
    target: string;
    detail?: unknown;
  }): Promise<void>;
  /** Newest first. */
  listTenantAudit(tenantId: string, limit: number): Promise<AuditEntry[]>;
}

export interface AuthStore {
  alfiz: StorageDriver;
  tenancy: TenancyStore;
  /** Every grant at any of the given scopes — a tenant's whole grant table. */
  listGrantsInScopes(scopes: string[]): Promise<GrantRow[]>;
}
