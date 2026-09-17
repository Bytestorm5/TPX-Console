/**
 * tpx-auth — tenants, projects, environments, membership, grants, audit.
 * The service is the Alfiz Application (org root) for the console; tpx-web
 * attaches an Alfiz client to it through the provider seam below.
 */
import { z } from "zod";
import { EnvironmentNameSchema, IdSchema, SlugSchema, type Ctx, type TenantCtx } from "./scope.ts";
import type { ProductCapabilities } from "./product.ts";

export const TenantSchema = z.object({
  /** The Clerk organization id — tenants ARE organizations. */
  id: IdSchema,
  name: z.string().min(1).max(120),
  /** The environment vocabulary. Connection defaults are keyed by these names. */
  environments: z.array(EnvironmentNameSchema).min(1).max(16),
  /** What a new project is created with; always a subset of `environments`. */
  projectDefaults: z.array(EnvironmentNameSchema).min(1).max(16),
  createdBy: IdSchema,
  createdAt: z.number().int(),
});
export type Tenant = z.infer<typeof TenantSchema>;

export const ProjectSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  slug: SlugSchema,
  name: z.string().min(1).max(120),
  createdAt: z.number().int(),
  archivedAt: z.number().int().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const EnvironmentSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema,
  name: EnvironmentNameSchema,
  createdAt: z.number().int(),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Derived from the name when omitted. */
  slug: SlugSchema.optional(),
  /** Defaults to the tenant's `projectDefaults`; every name must be in the vocabulary. */
  environments: z.array(EnvironmentNameSchema).min(1).max(16).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const UpdateTenantEnvironmentsInputSchema = z
  .object({
    environments: z.array(EnvironmentNameSchema).min(1).max(16),
    projectDefaults: z.array(EnvironmentNameSchema).min(1).max(16),
  })
  .refine((v) => v.projectDefaults.every((d) => v.environments.includes(d)), {
    message: "projectDefaults must be a subset of environments",
    path: ["projectDefaults"],
  });
export type UpdateTenantEnvironmentsInput = z.infer<typeof UpdateTenantEnvironmentsInputSchema>;

export const AddEnvironmentInputSchema = z.object({
  name: EnvironmentNameSchema,
  /**
   * Adding a name outside the vocabulary extends the vocabulary — a
   * deliberate tenant-level act that additionally requires
   * `tpx.workspace.environments.update_vocabulary`.
   */
  extendVocabulary: z.boolean().optional(),
});
export type AddEnvironmentInput = z.infer<typeof AddEnvironmentInputSchema>;

/** A grant row as the console shows it. Subjects are `user:<id>` or `org:<id>`. */
export const GrantViewSchema = z.object({
  id: IdSchema,
  subject: z.string(),
  roleId: z.string().optional(),
  pattern: z.string().optional(),
  scope: z.string(),
  expiresAt: z.number().int().optional(),
  createdAt: z.number().int(),
  provenance: z.unknown(),
});
export type GrantView = z.infer<typeof GrantViewSchema>;

export const CreateGrantInputSchema = z
  .object({
    subject: z.string().regex(/^(user|org):[^\s]{1,128}$/, "subject must be user:<id> or org:<id>"),
    roleId: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    /** A tenant, project or environment scope id belonging to the caller's tenant. */
    scope: z.string().min(1),
    expiresAt: z.number().int().positive().optional(),
  })
  .refine((v) => (v.roleId === undefined) !== (v.pattern === undefined), {
    message: "exactly one of roleId or pattern",
  });
export type CreateGrantInput = z.infer<typeof CreateGrantInputSchema>;

export const RoleViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  patterns: z.array(z.string()),
});
export type RoleView = z.infer<typeof RoleViewSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  at: z.number().int(),
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  detail: z.unknown().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export interface ResolvedScope {
  tenant: Tenant;
  project: Project;
  environment: Environment;
  /** Every environment of the project, so the shell can decide whether to show a switcher. */
  environments: Environment[];
}

/** The identity tpx-web resolved from the Clerk session. */
export interface EnsureUserInput {
  userId: string;
  orgId: string;
  /** Clerk's organization role for the active membership, e.g. `org:admin`. */
  orgRole: string | null;
}

export interface EnsureTenantInput {
  orgId: string;
  name: string;
  creatorUserId: string;
}

// ---------------------------------------------------------------------------
// The Alfiz provider seam — mirrors the parts of the provider contract a
// read-only remote client needs. Plain data only: this crosses an RPC boundary.
// ---------------------------------------------------------------------------
export type PrincipalRefWire = { userId: string } | { serviceId: string };

export interface SubjectAccessWire {
  userId: string | null;
  closure: string[];
  grants: GrantView[];
  revokes: Array<{
    id: string;
    userId: string;
    pattern: string;
    scope: string;
    createdAt: number;
    provenance: unknown;
  }>;
  roles: Array<{ id: string; name: string; description?: string | undefined; patterns: string[] }>;
  managerChain: string[];
  unresolvedRoleIds: string[];
  active: boolean;
}

export type InvalidationEventWire =
  | { type: "user"; userId: string }
  | { type: "subject"; subject: string }
  | { type: "scope"; scope: string }
  | { type: "role"; roleId: string }
  | { type: "catalog" }
  | { type: "all" };

export type EpochSinceWire = { upTo: number; events: InvalidationEventWire[] } | { gap: true };

export interface AuthProviderSeam {
  getSubjectAccess(principal: PrincipalRefWire): Promise<SubjectAccessWire>;
  resolveAncestors(scope: string): Promise<string[]>;
  epochHead(): Promise<number>;
  epochSince(seq: number, limit?: number): Promise<EpochSinceWire>;
}

/**
 * The RPC surface of the tpx-auth Worker (`services/auth`). Every tenant-scoped
 * method takes a `TenantCtx` and enforces its own grants — defence in depth
 * behind the ingress check.
 */
export interface AuthServiceContract extends AuthProviderSeam {
  capabilities(): Promise<ProductCapabilities>;

  /** Records the user's membership of the org (idempotent). Called at ingress. */
  ensureUser(input: EnsureUserInput): Promise<void>;
  /**
   * Creates the tenant row for a Clerk organization if it doesn't exist,
   * grants the creator the owner role at tenant scope and every org member
   * the member role. Idempotent: a second call returns the existing tenant.
   */
  ensureTenant(input: EnsureTenantInput): Promise<Tenant>;
  /** The tenant row for an organization, or null before bootstrap. Ids only; ingress-only. */
  findTenant(orgId: string): Promise<Tenant | null>;
  /** Removes a user's tenant-scoped grants and org link (Clerk webhook path). */
  removeMember(input: { orgId: string; userId: string }): Promise<void>;
  /** Ids only, no grants involved: ingress resolves the URL, then computes grants at the environment. */
  resolveScope(input: {
    tenantId: string;
    projectSlug: string;
    environmentName: string | null;
  }): Promise<ResolvedScope | null>;

  getTenant(ctx: TenantCtx): Promise<Tenant>;
  updateTenantEnvironments(ctx: TenantCtx, input: UpdateTenantEnvironmentsInput): Promise<Tenant>;
  /** The projects the caller may read — all of them with a tenant-level grant, otherwise per-project. */
  listProjects(ctx: TenantCtx): Promise<Project[]>;
  createProject(ctx: TenantCtx, input: CreateProjectInput): Promise<Project>;
  /** Project-shaped operations act on `ctx.projectId` with grants computed at the environment. */
  updateProject(ctx: Ctx, input: UpdateProjectInput): Promise<Project>;
  deleteProject(ctx: Ctx): Promise<void>;
  listEnvironments(ctx: Ctx): Promise<Environment[]>;
  addEnvironment(ctx: Ctx, input: AddEnvironmentInput): Promise<Environment>;

  listRoles(): Promise<RoleView[]>;
  listGrants(ctx: TenantCtx): Promise<GrantView[]>;
  createGrant(ctx: TenantCtx, input: CreateGrantInput): Promise<GrantView>;
  deleteGrant(ctx: TenantCtx, grantId: string): Promise<void>;
  listAudit(ctx: TenantCtx, options?: { limit?: number }): Promise<AuditEntry[]>;
}
