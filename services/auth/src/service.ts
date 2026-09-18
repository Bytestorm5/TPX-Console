/**
 * The auth service — the surface the console calls in-process. The Worker
 * entry constructs one `AuthService` with the Worker's env; loaders, actions
 * and the `/api/workspace/*` forwarder call its methods directly.
 *
 * Every tenant-scoped method parses its context, enforces the grant the
 * catalog names for it (`requireGrant`) and, for anything that changes
 * authority or destroys data, re-checks freshly against the org root
 * (`can.fresh`) so a stale context can never widen access. Nothing here is
 * reachable from the internet on its own: only the shell, which resolves the
 * identity and the scope first, ever calls it.
 *
 * Clerk only says who the user is. Tenants, membership and invitations are
 * the console's own rows, and membership is mirrored into Alfiz's directory
 * (`org:<tenantId>` in the user's closure) so tenant-wide grants apply.
 */
import { z } from "zod";
import { orgSubject, userSubject, type PrincipalRef, type Provenance } from "@alfiz/core";
import {
  AddEnvironmentInputSchema,
  CreateGrantInputSchema,
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  UpdateTenantEnvironmentsInputSchema,
  InviteMemberInputSchema,
  ProfileInputSchema,
  UpdateTenantInputSchema,
  type AuditEntry,
  type AuthServiceContract,
  type CreateGrantInput,
  type EnsureUserInput,
  type Environment,
  type EpochSinceWire,
  type GrantView,
  type Invite,
  type InviteResult,
  type Member,
  type PrincipalRefWire,
  type Project,
  type ResolvedScope,
  type RoleView,
  type SubjectAccessWire,
  type Tenant,
  type TenantSummary,
  type UserSession,
} from "@tpx/contracts/auth";
import type { ProductCapabilities } from "@tpx/contracts/product";
import { CtxSchema, IdSchema, TenantCtxSchema, type Ctx, type TenantCtx } from "@tpx/contracts/scope";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ROLE_IDS,
  ValidationError,
  catalog,
  defaultTenantName,
  environmentScope,
  parseTpxScope,
  projectScope,
  requireGrant,
  tenantScope,
  type TpxKey,
} from "@tpx/identity";
import { getAlfiz, type AlfizRuntime } from "./alfiz.ts";
import { newId, slugify } from "./ids.ts";
import { createConvexCaller } from "@tpx/convex-client";
import { convexStore } from "./store/convex-store.ts";
import { memoryStore } from "./store/memory-store.ts";
import type { AuthStore } from "./store/types.ts";

/** The slice of the Worker's env the auth service reads. */
export interface AuthEnv {
  CONVEX_URL: string;
  CONVEX_DEPLOY_KEY: string;
  /** `memory` runs the service against an in-memory store — local development only. */
  TPX_STORE?: string;
}

const DEFAULT_VOCABULARY = ["prod"];
const DIRECTORY_SOURCE = "tpx-auth";
const AUDIT_LIMIT_DEFAULT = 100;
const AUDIT_LIMIT_MAX = 500;
const ENSURE_USER_TTL_MS = 60_000;
const SEP = "|";

const EnsureUserInputSchema = z.object({ userId: IdSchema, profile: ProfileInputSchema.optional() });
const CreateTenantInputSchema = z.object({ name: z.string().trim().min(1).max(120), creatorUserId: IdSchema });
const ResolveScopeInputSchema = z.object({
  tenantId: IdSchema,
  projectSlug: z.string().min(1).max(64),
  environmentName: z.string().min(1).max(32).nullable(),
});
const PrincipalSchema = z.union([z.object({ userId: IdSchema }), z.object({ serviceId: IdSchema })]);

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

const adminProvenance = (ctx: { userId: string }): Provenance => ({ kind: "admin", actorUserId: ctx.userId });

const toGrantView = (g: {
  id: string;
  subject: string;
  roleId?: string | undefined;
  pattern?: string | undefined;
  scope: string;
  expiresAt?: number | undefined;
  createdAt: number;
  provenance: unknown;
}): GrantView => ({
  id: g.id,
  subject: g.subject,
  ...(g.roleId === undefined ? {} : { roleId: g.roleId }),
  ...(g.pattern === undefined ? {} : { pattern: g.pattern }),
  scope: g.scope,
  ...(g.expiresAt === undefined ? {} : { expiresAt: g.expiresAt }),
  createdAt: g.createdAt,
  provenance: g.provenance,
});

// -- store resolution ---------------------------------------------------------
const storesByUrl = new Map<string, AuthStore>();
let storeOverride: AuthStore | null = null;

/** Tests swap the store for an in-memory one; production never calls this. */
export function __setStoreForTests(store: AuthStore | null): void {
  storeOverride = store;
}

let devMemoryStore: AuthStore | null = null;

function resolveStore(env: AuthEnv): AuthStore {
  if (storeOverride) return storeOverride;
  if (env.TPX_STORE === "memory") {
    devMemoryStore ??= memoryStore();
    return devMemoryStore;
  }
  if (!env.CONVEX_URL || !env.CONVEX_DEPLOY_KEY) {
    throw new Error("auth service: CONVEX_URL and CONVEX_DEPLOY_KEY must be configured");
  }
  const key = `${env.CONVEX_URL}${SEP}${env.CONVEX_DEPLOY_KEY}`;
  let store = storesByUrl.get(key);
  if (!store) {
    store = convexStore(createConvexCaller({ url: env.CONVEX_URL, deployKey: env.CONVEX_DEPLOY_KEY }));
    storesByUrl.set(key, store);
  }
  return store;
}

const ensureUserSeen = new Map<string, number>();

export class AuthService implements AuthServiceContract {
  readonly #env: AuthEnv;

  constructor(env: AuthEnv) {
    this.#env = env;
  }

  // -- plumbing -----------------------------------------------------------------
  async #runtime(): Promise<AlfizRuntime> {
    const runtime = getAlfiz(resolveStore(this.#env));
    await runtime.ready;
    return runtime;
  }

  async #tenantCtx(
    ctx: unknown,
    key: TpxKey,
    options: { fresh?: boolean } = {},
  ): Promise<{ ctx: TenantCtx; rt: AlfizRuntime }> {
    const parsed = parse(TenantCtxSchema, ctx);
    requireGrant(parsed, key);
    const rt = await this.#runtime();
    if (options.fresh) await this.#assertFresh(rt, parsed.userId, key, tenantScope(parsed.tenantId));
    return { ctx: parsed, rt };
  }

  async #scopedCtx(
    ctx: unknown,
    key: TpxKey,
    options: { fresh?: boolean } = {},
  ): Promise<{ ctx: Ctx; rt: AlfizRuntime }> {
    const parsed = parse(CtxSchema, ctx);
    requireGrant(parsed, key);
    const rt = await this.#runtime();
    if (options.fresh) await this.#assertFresh(rt, parsed.userId, key, environmentScope(parsed.environmentId));
    return { ctx: parsed, rt };
  }

  /** The uncached re-check for destructive and authority-changing writes. */
  async #assertFresh(rt: AlfizRuntime, userId: string, key: TpxKey, scope: string): Promise<void> {
    const allowed = await rt.client.can.fresh({ userId }, key, scope);
    if (!allowed) throw new ForbiddenError(`fresh check failed for ${key}`, key);
  }

  async #tenant(rt: AlfizRuntime, tenantId: string): Promise<Tenant> {
    const tenant = await rt.store.tenancy.getTenant(tenantId);
    if (!tenant) throw new NotFoundError("tenant not found");
    return tenant;
  }

  async #audit(
    rt: AlfizRuntime,
    tenantId: string,
    actor: string,
    action: string,
    target: string,
    detail?: unknown,
  ): Promise<void> {
    await rt.store.tenancy.recordAudit({
      id: newId("aud"),
      tenantId,
      at: Date.now(),
      actor,
      action,
      target,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  async #tenantScopes(rt: AlfizRuntime, tenantId: string): Promise<string[]> {
    const [projects, environments] = await Promise.all([
      rt.store.tenancy.listProjects(tenantId),
      rt.store.tenancy.listTenantEnvironments(tenantId),
    ]);
    return [
      tenantScope(tenantId),
      ...projects.map((p) => projectScope(p.id)),
      ...environments.map((e) => environmentScope(e.id)),
    ];
  }

  /** Whether `scope` is the tenant itself or a project/environment inside it. */
  async #scopeBelongsToTenant(rt: AlfizRuntime, tenantId: string, scope: string): Promise<boolean> {
    const parsed = parseTpxScope(scope);
    if (!parsed) return false;
    switch (parsed.level) {
      case "global":
        return false;
      case "tenant":
        return parsed.tenantId === tenantId;
      case "project":
        return (await rt.store.tenancy.getProject(tenantId, parsed.projectId)) !== null;
      case "environment":
        return (await rt.store.tenancy.getEnvironment(tenantId, parsed.environmentId)) !== null;
    }
  }

  async #createProjectRows(
    rt: AlfizRuntime,
    tenant: Tenant,
    input: { name: string; slug?: string | undefined; environments?: string[] | undefined },
    actor: string,
  ): Promise<Project> {
    const names = input.environments ?? tenant.projectDefaults;
    const unknown = names.filter((n) => !tenant.environments.includes(n));
    if (unknown.length > 0) {
      throw new ValidationError(`environments not in the tenant vocabulary: ${unknown.join(", ")}`);
    }
    const now = Date.now();
    const project: Project = {
      id: newId("prj"),
      tenantId: tenant.id,
      slug: input.slug ?? slugify(input.name),
      name: input.name,
      createdAt: now,
      archivedAt: null,
    };
    const environments: Environment[] = [...new Set(names)].map((name, index) => ({
      id: newId("env"),
      tenantId: tenant.id,
      projectId: project.id,
      name,
      createdAt: now + index,
    }));
    const inserted = await rt.store.tenancy.insertProject(project, environments);
    if (!inserted) throw new ConflictError(`a project with slug ${JSON.stringify(project.slug)} already exists`);
    await this.#audit(rt, tenant.id, actor, "project.create", project.id, {
      slug: project.slug,
      environments: environments.map((e) => e.name),
    });
    return project;
  }

  // -- the JSON surface ---------------------------------------------------------
  /**
   * The HTTP surface behind the shell's `/api/workspace/*` forwarder. The
   * forwarder has already resolved the caller's scope into `ctx`, and the
   * request URL is relative to the product root (`/whoami`, not
   * `/api/workspace/whoami`).
   */
  async handle(ctx: Ctx, request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/whoami") return Response.json(parse(CtxSchema, ctx));
    return Response.json({ error: "not found" }, { status: 404 });
  }

  async capabilities(): Promise<ProductCapabilities> {
    return {
      product: "workspace",
      enabled: true,
      features: ["projects", "environments", "access", "audit"],
      version: "0.1.0",
    };
  }

  // -- the provider seam (read-only closure supply for tpx-web) -------------------
  async getSubjectAccess(principal: PrincipalRefWire): Promise<SubjectAccessWire> {
    const rt = await this.#runtime();
    return (await rt.app.getSubjectAccess(
      parse(PrincipalSchema, principal) as PrincipalRef,
    )) as unknown as SubjectAccessWire;
  }

  async resolveAncestors(scope: string): Promise<string[]> {
    const rt = await this.#runtime();
    return rt.app.resolveAncestors(parse(z.string().min(1), scope));
  }

  async epochHead(): Promise<number> {
    const rt = await this.#runtime();
    return rt.app.epoch ? rt.app.epoch.head() : 0;
  }

  async epochSince(seq: number, limit?: number): Promise<EpochSinceWire> {
    const rt = await this.#runtime();
    if (!rt.app.epoch) return { upTo: seq, events: [] };
    return (await rt.app.epoch.since(parse(z.number().int().min(0), seq), limit)) as EpochSinceWire;
  }

  // -- identity bootstrap (ingress) ------------------------------------------------
  /** Alfiz's directory is the authority for `org:<tenant>` closure: keep the user's org ids in step with memberships. */
  async #syncDirectory(rt: AlfizRuntime, userId: string): Promise<void> {
    const memberships = await rt.store.tenancy.listMemberships(userId);
    const orgIds = memberships.map((m) => m.tenantId);
    const user = await rt.store.alfiz.getUser(userId);
    const same = user && user.orgIds.length === orgIds.length && orgIds.every((id) => user.orgIds.includes(id));
    if (same) return;
    await rt.app.importDirectory({ users: [{ userId }], orgs: { [userId]: orgIds } }, DIRECTORY_SOURCE);
  }

  async #addMember(
    rt: AlfizRuntime,
    tenantId: string,
    userId: string,
    roleId: string,
    provenance: Provenance,
    invitedBy: string | null,
  ): Promise<void> {
    const inserted = await rt.store.tenancy.insertMembership({ tenantId, userId, joinedAt: Date.now(), invitedBy });
    if (!inserted) return;
    await this.#syncDirectory(rt, userId);
    await rt.app.createGrant({ subject: userSubject(userId), roleId, scope: tenantScope(tenantId), provenance });
    await this.#audit(rt, tenantId, invitedBy ?? "system", "member.add", userId, { roleId });
  }

  async #createTenantRows(rt: AlfizRuntime, name: string, creatorUserId: string): Promise<Tenant> {
    const tenant: Tenant = {
      id: newId("tnt"),
      name,
      environments: [...DEFAULT_VOCABULARY],
      projectDefaults: [...DEFAULT_VOCABULARY],
      createdBy: creatorUserId,
      createdAt: Date.now(),
    };
    const inserted = await rt.store.tenancy.insertTenant(tenant);
    if (!inserted) throw new ConflictError("tenant id collision");
    await rt.store.tenancy.insertMembership({
      tenantId: tenant.id,
      userId: creatorUserId,
      joinedAt: tenant.createdAt,
      invitedBy: null,
    });
    await this.#syncDirectory(rt, creatorUserId);
    await rt.app.createGrants(
      [
        { subject: userSubject(creatorUserId), roleId: ROLE_IDS.owner, scope: tenantScope(tenant.id) },
        { subject: orgSubject(tenant.id), roleId: ROLE_IDS.member, scope: tenantScope(tenant.id) },
      ],
      { kind: "system", note: "tenant bootstrap" },
    );
    await this.#audit(rt, tenant.id, creatorUserId, "tenant.create", tenant.id, { name });
    await this.#createProjectRows(rt, tenant, { name: "Default", slug: "default" }, creatorUserId);
    return tenant;
  }

  async #tenantSummaries(rt: AlfizRuntime, userId: string): Promise<TenantSummary[]> {
    const memberships = await rt.store.tenancy.listMemberships(userId);
    const tenants = await Promise.all(memberships.map((m) => rt.store.tenancy.getTenant(m.tenantId)));
    return memberships.flatMap((m, i) => {
      const tenant = tenants[i];
      return tenant ? [{ id: tenant.id, name: tenant.name, joinedAt: m.joinedAt }] : [];
    });
  }

  async ensureUser(input: EnsureUserInput): Promise<UserSession> {
    const { userId, profile } = parse(EnsureUserInputSchema, input);
    const rt = await this.#runtime();
    let stored = await rt.store.tenancy.getUser(userId);
    if (profile) {
      stored = { userId, ...profile, updatedAt: Date.now() };
      await rt.store.tenancy.upsertUser(stored);
    }
    const memoKey = `${userId}${SEP}${stored?.email ?? ""}`;
    const seen = ensureUserSeen.get(memoKey);
    if (seen === undefined || Date.now() - seen >= ENSURE_USER_TTL_MS) {
      await this.#syncDirectory(rt, userId);
      // Invitations addressed to this email become memberships on sight.
      if (stored?.email) {
        for (const invite of await rt.store.tenancy.listInvitesForEmail(stored.email)) {
          const claimed = await rt.store.tenancy.deleteInvite(invite.id);
          if (!claimed) continue;
          await this.#addMember(
            rt,
            invite.tenantId,
            userId,
            invite.roleId,
            { kind: "admin", actorUserId: invite.invitedBy },
            invite.invitedBy,
          );
          await this.#audit(rt, invite.tenantId, userId, "invite.claim", invite.id, { roleId: invite.roleId });
        }
      }
      ensureUserSeen.set(memoKey, Date.now());
    }
    let tenants = await this.#tenantSummaries(rt, userId);
    if (tenants.length === 0 && stored) {
      // A new user gets a tenant by default; more can be created from the switcher. Never before the
      // profile is known: the tenant is named after the person, and invitations are claimed by email.
      const name = defaultTenantName({ displayName: stored.displayName, email: stored.email });
      await this.#createTenantRows(rt, name, userId);
      tenants = await this.#tenantSummaries(rt, userId);
    }
    return { user: stored, tenants };
  }

  async createTenant(input: { name: string; creatorUserId: string }): Promise<Tenant> {
    const { name, creatorUserId } = parse(CreateTenantInputSchema, input);
    const rt = await this.#runtime();
    return this.#createTenantRows(rt, name, creatorUserId);
  }

  async findTenant(tenantId: string): Promise<Tenant | null> {
    const rt = await this.#runtime();
    return rt.store.tenancy.getTenant(parse(IdSchema, tenantId));
  }

  async #sweepMember(rt: AlfizRuntime, tenantId: string, userId: string, actor: string): Promise<number> {
    const scopes = new Set(await this.#tenantScopes(rt, tenantId));
    const grants = (await rt.app.listGrants({ subject: userSubject(userId) })).filter((g) => scopes.has(g.scope));
    for (const g of grants) await rt.app.deleteGrant(g.id, { kind: "system", note: "membership removed" });
    await rt.store.tenancy.deleteMembership(tenantId, userId);
    await this.#syncDirectory(rt, userId);
    for (const key of ensureUserSeen.keys()) if (key.startsWith(`${userId}${SEP}`)) ensureUserSeen.delete(key);
    await this.#audit(rt, tenantId, actor, "member.remove", userId, { deletedGrants: grants.length });
    return grants.length;
  }

  async forgetUser(userId: string): Promise<void> {
    const id = parse(IdSchema, userId);
    const rt = await this.#runtime();
    for (const m of await rt.store.tenancy.listMemberships(id)) await this.#sweepMember(rt, m.tenantId, id, "system");
    await rt.store.tenancy.deleteUser(id);
    await rt.app.importDirectory({ users: [{ userId: id, active: false }] }, DIRECTORY_SOURCE);
  }

  async resolveScope(input: {
    tenantId: string;
    projectSlug: string;
    environmentName: string | null;
  }): Promise<ResolvedScope | null> {
    const { tenantId, projectSlug, environmentName } = parse(ResolveScopeInputSchema, input);
    const rt = await this.#runtime();
    const tenant = await rt.store.tenancy.getTenant(tenantId);
    if (!tenant) return null;
    const project = await rt.store.tenancy.getProjectBySlug(tenantId, projectSlug);
    if (!project || project.archivedAt !== null) return null;
    const environments = await rt.store.tenancy.listEnvironments(tenantId, project.id);
    const environment =
      environmentName !== null
        ? environments.find((e) => e.name === environmentName)
        : (environments.find((e) => e.name === tenant.projectDefaults[0]) ?? environments[0]);
    if (!environment) return null;
    return { tenant, project, environment, environments };
  }

  // -- tenant ---------------------------------------------------------------------
  async getTenant(ctx: TenantCtx): Promise<Tenant> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.environments.read");
    return this.#tenant(rt, c.tenantId);
  }

  async updateTenantEnvironments(ctx: TenantCtx, input: unknown): Promise<Tenant> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.environments.update_vocabulary", { fresh: true });
    const parsed = parse(UpdateTenantEnvironmentsInputSchema, input);
    const tenant = await this.#tenant(rt, c.tenantId);
    const environments = [...new Set(parsed.environments)];
    const removed = tenant.environments.filter((n) => !environments.includes(n));
    if (removed.length > 0) {
      const inUse = new Set((await rt.store.tenancy.listTenantEnvironments(c.tenantId)).map((e) => e.name));
      const blocked = removed.filter((n) => inUse.has(n));
      if (blocked.length > 0) throw new ConflictError(`still used by an environment: ${blocked.join(", ")}`);
    }
    await rt.store.tenancy.updateTenantVocabulary(c.tenantId, environments, [...new Set(parsed.projectDefaults)]);
    await this.#audit(rt, c.tenantId, c.userId, "tenant.environments.update", c.tenantId, {
      environments,
      projectDefaults: parsed.projectDefaults,
    });
    return this.#tenant(rt, c.tenantId);
  }

  async updateTenant(ctx: TenantCtx, input: unknown): Promise<Tenant> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.settings.update_settings", { fresh: true });
    const parsed = parse(UpdateTenantInputSchema, input);
    await this.#tenant(rt, c.tenantId);
    await rt.store.tenancy.updateTenantName(c.tenantId, parsed.name);
    await this.#audit(rt, c.tenantId, c.userId, "tenant.update", c.tenantId, { name: parsed.name });
    return this.#tenant(rt, c.tenantId);
  }

  // -- members --------------------------------------------------------------------
  async #memberView(rt: AlfizRuntime, tenantId: string, userId: string, joinedAt: number): Promise<Member> {
    const [profile, grants] = await Promise.all([
      rt.store.tenancy.getUser(userId),
      rt.app.listGrants({ subject: userSubject(userId), scope: tenantScope(tenantId) }),
    ]);
    return {
      userId,
      email: profile?.email ?? null,
      displayName: profile?.displayName ?? null,
      imageUrl: profile?.imageUrl ?? null,
      joinedAt,
      roles: grants.flatMap((g) => (g.roleId ? [g.roleId] : [])),
    };
  }

  async listMembers(ctx: TenantCtx): Promise<Member[]> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.members.read");
    const rows = await rt.store.tenancy.listMembers(c.tenantId);
    return Promise.all(rows.map((m) => this.#memberView(rt, c.tenantId, m.userId, m.joinedAt)));
  }

  async inviteMember(ctx: TenantCtx, input: unknown): Promise<InviteResult> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.members.manage_members", { fresh: true });
    const parsed = parse(InviteMemberInputSchema, input);
    if (!(await rt.app.listRoles()).some((r) => r.id === parsed.roleId)) {
      throw new ValidationError(`unknown role ${JSON.stringify(parsed.roleId)}`);
    }
    const known = await rt.store.tenancy.getUserByEmail(parsed.email);
    if (known) {
      const members = await rt.store.tenancy.listMembers(c.tenantId);
      if (members.some((m) => m.userId === known.userId)) throw new ConflictError("already a member");
      await this.#addMember(rt, c.tenantId, known.userId, parsed.roleId, adminProvenance(c), c.userId);
      return { kind: "added", member: await this.#memberView(rt, c.tenantId, known.userId, Date.now()) };
    }
    const invite: Invite = {
      id: newId("inv"),
      tenantId: c.tenantId,
      email: parsed.email,
      roleId: parsed.roleId,
      invitedBy: c.userId,
      createdAt: Date.now(),
    };
    const inserted = await rt.store.tenancy.insertInvite(invite);
    if (!inserted) throw new ConflictError("an invitation for that address is already pending");
    await this.#audit(rt, c.tenantId, c.userId, "invite.create", invite.id, {
      email: invite.email,
      roleId: invite.roleId,
    });
    return { kind: "invited", invite };
  }

  async listInvites(ctx: TenantCtx): Promise<Invite[]> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.members.read");
    return rt.store.tenancy.listInvites(c.tenantId);
  }

  async revokeInvite(ctx: TenantCtx, inviteId: string): Promise<void> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.members.manage_members", { fresh: true });
    const id = parse(IdSchema, inviteId);
    const pending = (await rt.store.tenancy.listInvites(c.tenantId)).find((i) => i.id === id);
    if (!pending) throw new NotFoundError("invitation not found");
    await rt.store.tenancy.deleteInvite(id);
    await this.#audit(rt, c.tenantId, c.userId, "invite.revoke", id, { email: pending.email });
  }

  async removeMember(ctx: TenantCtx, userId: string): Promise<void> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.members.manage_members", { fresh: true });
    const id = parse(IdSchema, userId);
    const members = await rt.store.tenancy.listMembers(c.tenantId);
    if (!members.some((m) => m.userId === id)) throw new NotFoundError("not a member");
    const owners = (await rt.app.listGrants({ scope: tenantScope(c.tenantId), roleId: ROLE_IDS.owner })).map(
      (g) => g.subject,
    );
    if (owners.includes(userSubject(id)) && owners.every((s) => s === userSubject(id))) {
      throw new ConflictError("a tenant must keep at least one owner");
    }
    await this.#sweepMember(rt, c.tenantId, id, c.userId);
  }

  // -- projects -------------------------------------------------------------------
  async listProjects(ctx: TenantCtx): Promise<Project[]> {
    const c = parse(TenantCtxSchema, ctx);
    const rt = await this.#runtime();
    const projects = await rt.store.tenancy.listProjects(c.tenantId);
    if (c.grants.includes("tpx.workspace.projects.read")) return projects;
    const visible: Project[] = [];
    for (const project of projects) {
      if (await rt.client.can({ userId: c.userId }, "tpx.workspace.projects.read", projectScope(project.id)))
        visible.push(project);
    }
    return visible;
  }

  async createProject(ctx: TenantCtx, input: unknown): Promise<Project> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.projects.create_project");
    const parsed = parse(CreateProjectInputSchema, input);
    const tenant = await this.#tenant(rt, c.tenantId);
    return this.#createProjectRows(rt, tenant, parsed, c.userId);
  }

  async updateProject(ctx: Ctx, input: unknown): Promise<Project> {
    const { ctx: c, rt } = await this.#scopedCtx(ctx, "tpx.workspace.projects.update_project");
    const parsed = parse(UpdateProjectInputSchema, input);
    const project = await rt.store.tenancy.getProject(c.tenantId, c.projectId);
    if (!project) throw new NotFoundError("project not found");
    await rt.store.tenancy.updateProject(c.tenantId, c.projectId, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.archived === undefined ? {} : { archivedAt: parsed.archived ? Date.now() : null }),
    });
    await this.#audit(rt, c.tenantId, c.userId, "project.update", c.projectId, parsed);
    const updated = await rt.store.tenancy.getProject(c.tenantId, c.projectId);
    if (!updated) throw new NotFoundError("project not found");
    return updated;
  }

  async deleteProject(ctx: Ctx): Promise<void> {
    const { ctx: c, rt } = await this.#scopedCtx(ctx, "tpx.workspace.projects.delete", { fresh: true });
    const project = await rt.store.tenancy.getProject(c.tenantId, c.projectId);
    if (!project) throw new NotFoundError("project not found");
    const environments = await rt.store.tenancy.listEnvironments(c.tenantId, c.projectId);
    await rt.store.tenancy.deleteProject(c.tenantId, c.projectId);
    const provenance = adminProvenance(c);
    for (const e of environments) await rt.app.deleteScope(environmentScope(e.id), provenance);
    await rt.app.deleteScope(projectScope(c.projectId), provenance);
    await this.#audit(rt, c.tenantId, c.userId, "project.delete", c.projectId, { slug: project.slug });
  }

  // -- environments ---------------------------------------------------------------
  async listEnvironments(ctx: Ctx): Promise<Environment[]> {
    const { ctx: c, rt } = await this.#scopedCtx(ctx, "tpx.workspace.environments.read");
    return rt.store.tenancy.listEnvironments(c.tenantId, c.projectId);
  }

  async addEnvironment(ctx: Ctx, input: unknown): Promise<Environment> {
    const { ctx: c, rt } = await this.#scopedCtx(ctx, "tpx.workspace.environments.add_environment");
    const parsed = parse(AddEnvironmentInputSchema, input);
    const tenant = await this.#tenant(rt, c.tenantId);
    if (!(await rt.store.tenancy.getProject(c.tenantId, c.projectId))) throw new NotFoundError("project not found");
    if (!tenant.environments.includes(parsed.name)) {
      if (!parsed.extendVocabulary) {
        throw new ValidationError(
          `${JSON.stringify(parsed.name)} is not in the tenant's environment vocabulary; pass extendVocabulary to add it`,
        );
      }
      requireGrant(c, "tpx.workspace.environments.update_vocabulary");
      await this.#assertFresh(rt, c.userId, "tpx.workspace.environments.update_vocabulary", tenantScope(c.tenantId));
      await rt.store.tenancy.updateTenantVocabulary(
        c.tenantId,
        [...tenant.environments, parsed.name],
        tenant.projectDefaults,
      );
      await this.#audit(rt, c.tenantId, c.userId, "tenant.environments.extend", c.tenantId, { added: parsed.name });
    }
    const environment: Environment = {
      id: newId("env"),
      tenantId: c.tenantId,
      projectId: c.projectId,
      name: parsed.name,
      createdAt: Date.now(),
    };
    const inserted = await rt.store.tenancy.insertEnvironment(environment);
    if (!inserted) throw new ConflictError(`environment ${JSON.stringify(parsed.name)} already exists in this project`);
    await this.#audit(rt, c.tenantId, c.userId, "environment.create", environment.id, {
      projectId: c.projectId,
      name: parsed.name,
    });
    return environment;
  }

  // -- access ---------------------------------------------------------------------
  async listRoles(): Promise<RoleView[]> {
    const rt = await this.#runtime();
    return (await rt.app.listRoles()).map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.description === undefined ? {} : { description: r.description }),
      patterns: [...r.patterns],
    }));
  }

  async listGrants(ctx: TenantCtx): Promise<GrantView[]> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.access.read");
    return (await rt.store.listGrantsInScopes(await this.#tenantScopes(rt, c.tenantId))).map(toGrantView);
  }

  async createGrant(ctx: TenantCtx, input: unknown): Promise<GrantView> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.access.manage_grants", { fresh: true });
    const parsed: CreateGrantInput = parse(CreateGrantInputSchema, input);
    if (!(await this.#scopeBelongsToTenant(rt, c.tenantId, parsed.scope))) {
      throw new ForbiddenError("scope is outside your tenant");
    }
    if (parsed.subject.startsWith("org:") && parsed.subject !== orgSubject(c.tenantId)) {
      throw new ForbiddenError("only your own organization can be a subject");
    }
    if (parsed.roleId !== undefined && !(await rt.app.listRoles()).some((r) => r.id === parsed.roleId)) {
      throw new ValidationError(`unknown role ${JSON.stringify(parsed.roleId)}`);
    }
    if (parsed.pattern !== undefined && !catalog.isKnownPattern(parsed.pattern)) {
      throw new ValidationError(`unknown permission pattern ${JSON.stringify(parsed.pattern)}`);
    }
    const grant = await rt.app.createGrant({
      subject: parsed.subject,
      ...(parsed.roleId === undefined ? {} : { roleId: parsed.roleId }),
      ...(parsed.pattern === undefined ? {} : { pattern: parsed.pattern }),
      scope: parsed.scope,
      ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
      provenance: adminProvenance(c),
    });
    await this.#audit(rt, c.tenantId, c.userId, "grant.create", grant.id, {
      subject: grant.subject,
      roleId: grant.roleId,
      pattern: grant.pattern,
      scope: grant.scope,
    });
    return toGrantView(grant);
  }

  async deleteGrant(ctx: TenantCtx, grantId: string): Promise<void> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.access.manage_grants", { fresh: true });
    const id = parse(IdSchema, grantId);
    const scopes = await this.#tenantScopes(rt, c.tenantId);
    const grants = await rt.store.listGrantsInScopes(scopes);
    const grant = grants.find((g) => g.id === id);
    if (!grant) throw new NotFoundError("grant not found in your tenant");
    if (grant.roleId === ROLE_IDS.owner && grant.scope === tenantScope(c.tenantId)) {
      const otherOwners = grants.filter((g) => g.id !== id && g.roleId === ROLE_IDS.owner && g.scope === grant.scope);
      if (otherOwners.length === 0) throw new ConflictError("a tenant must keep at least one owner");
    }
    await rt.app.deleteGrant(id, adminProvenance(c));
    await this.#audit(rt, c.tenantId, c.userId, "grant.delete", id, {
      subject: grant.subject,
      roleId: grant.roleId,
      pattern: grant.pattern,
      scope: grant.scope,
    });
  }

  async listAudit(ctx: TenantCtx, options?: { limit?: number }): Promise<AuditEntry[]> {
    const { ctx: c, rt } = await this.#tenantCtx(ctx, "tpx.workspace.audit.read");
    const limit = Math.min(Math.max(1, Math.trunc(options?.limit ?? AUDIT_LIMIT_DEFAULT)), AUDIT_LIMIT_MAX);
    return rt.store.tenancy.listTenantAudit(c.tenantId, limit);
  }
}
