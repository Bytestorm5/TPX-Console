import { beforeEach, describe, expect, it } from "vitest";
import { environmentScope, grantsAt, projectScope, tenantScope, ROLE_IDS, isTpxError } from "@tpx/identity";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import { AuthService, __setStoreForTests, getAlfiz, memoryStore, type AuthEnv } from "../../src/index.ts";
import type { AuthStore } from "../../src/store/types.ts";

/** Never reached: every test overrides the store with an in-memory one. */
const TEST_ENV: AuthEnv = { CONVEX_URL: "https://test.invalid", CONVEX_DEPLOY_KEY: "test" };

let store: AuthStore;
let service: AuthService;

beforeEach(() => {
  store = memoryStore();
  __setStoreForTests(store);
  service = new AuthService(TEST_ENV);
});

async function tenantCtx(userId: string, tenantId: string): Promise<TenantCtx> {
  const rt = getAlfiz(store);
  await rt.ready;
  const snap = await rt.client.snapshot({ userId }, { fresh: true });
  return { tenantId, userId, grants: grantsAt(snap, tenantScope(tenantId)) };
}

async function scopedCtx(
  userId: string,
  tenantId: string,
  projectId: string,
  environmentId: string,
  environmentName = "prod",
): Promise<Ctx> {
  const rt = getAlfiz(store);
  await rt.ready;
  const scope = environmentScope(environmentId);
  const snap = await rt.client.snapshot({ userId }, { scopes: [scope], fresh: true });
  return { tenantId, userId, projectId, environmentId, environmentName, grants: grantsAt(snap, scope) };
}

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    return isTpxError(e) ? e.status : -1;
  }
}

const ADA = { email: "ada@example.test", displayName: "Ada Lovelace", imageUrl: null };

/** Ingress for a user: profile stored, invitations claimed, a default tenant when they have none. */
async function signIn(userId: string, email = `${userId}@example.test`, displayName = userId) {
  return service.ensureUser({ userId, profile: { email, displayName, imageUrl: null } });
}

/** The fixture most tests start from: ada signs in and gets "Ada's Org" (id captured as `org_a`). */
async function bootstrap(): Promise<string> {
  const session = await signIn("ada", ADA.email, ADA.displayName);
  return session.tenants[0]!.id;
}

describe("tenant bootstrap", () => {
  it("gives a new user a default tenant with a prod-only vocabulary, a default project, and ownership", async () => {
    const session = await signIn("ada", ADA.email, ADA.displayName);
    expect(session.user).toMatchObject({ userId: "ada", email: ADA.email, displayName: ADA.displayName });
    expect(session.tenants).toHaveLength(1);
    const tenantId = session.tenants[0]!.id;
    expect(session.tenants[0]!.name).toBe("Ada's Org");
    expect(tenantId).toMatch(/^tnt_/);
    expect(await service.findTenant(tenantId)).toMatchObject({
      environments: ["prod"],
      projectDefaults: ["prod"],
      createdBy: "ada",
    });
    expect(await service.findTenant("tnt_missing")).toBeNull();

    // An unknown user without a profile gets nothing yet: tpx-web sends the profile and calls again.
    const unknown = await service.ensureUser({ userId: "ghost" });
    expect(unknown).toEqual({ user: null, tenants: [] });

    // Idempotent: signing in again (with or without the profile) creates nothing new.
    expect((await service.ensureUser({ userId: "ada" })).tenants).toHaveLength(1);
    expect((await signIn("ada", ADA.email, ADA.displayName)).tenants).toHaveLength(1);

    const scope = await service.resolveScope({ tenantId, projectSlug: "default", environmentName: null });
    expect(scope?.project.name).toBe("Default");
    expect(scope?.environment.name).toBe("prod");
    expect(scope?.environments).toHaveLength(1);

    const ctx = await tenantCtx("ada", tenantId);
    expect(ctx.grants).toContain("tpx.workspace.access.manage_grants");
    expect(ctx.grants).toContain("tpx.workspace.projects.delete");
    const grants = await service.listGrants(ctx);
    expect(grants.map((g) => `${g.subject}:${g.roleId}`).sort()).toEqual([
      `org:${tenantId}:${ROLE_IDS.member}`,
      `user:ada:${ROLE_IDS.owner}`,
    ]);
  });

  it("lets a user create more tenants and rename them", async () => {
    const first = await bootstrap();
    const second = await service.createTenant({ name: "Acme", creatorUserId: "ada" });
    expect(second.id).not.toBe(first);
    const session = await service.ensureUser({ userId: "ada" });
    expect(session.tenants.map((t) => t.name)).toEqual(["Ada's Org", "Acme"]);
    const ctx = await tenantCtx("ada", second.id);
    expect((await service.updateTenant(ctx, { name: "Acme Ltd" })).name).toBe("Acme Ltd");
    expect(await status(service.updateTenant({ ...ctx, grants: [] }, { name: "Nope" }))).toBe(403);
  });

  it("invites by email: known users join at once, unknown ones on their first sign-in", async () => {
    const tenantId = await bootstrap();
    const ada = await tenantCtx("ada", tenantId);
    await signIn("bob", "bob@example.test", "Bob");

    const added = await service.inviteMember(ada, { email: "Bob@Example.test", roleId: ROLE_IDS.member });
    expect(added.kind).toBe("added");
    let bob = await tenantCtx("bob", tenantId);
    expect(bob.grants).toContain("tpx.connections.attachments.attach_connection");
    expect(bob.grants).not.toContain("tpx.workspace.access.manage_grants");
    expect(await status(service.inviteMember(ada, { email: "bob@example.test", roleId: ROLE_IDS.member }))).toBe(409);

    const invited = await service.inviteMember(ada, { email: "cat@example.test", roleId: ROLE_IDS.admin });
    expect(invited.kind).toBe("invited");
    expect((await service.listInvites(ada)).map((i) => i.email)).toEqual(["cat@example.test"]);
    expect(await status(service.inviteMember(ada, { email: "cat@example.test", roleId: ROLE_IDS.admin }))).toBe(409);
    expect(await status(service.inviteMember(ada, { email: "dan@example.test", roleId: "nope" }))).toBe(400);

    // Cat signs in for the first time: the invitation becomes a membership, and no default tenant is created.
    const cat = await signIn("cat", "cat@example.test", "Cat");
    expect(cat.tenants.map((t) => t.id)).toEqual([tenantId]);
    expect(await service.listInvites(ada)).toEqual([]);
    const catCtx = await tenantCtx("cat", tenantId);
    expect(catCtx.grants).toContain("tpx.workspace.access.manage_grants");
    expect(catCtx.grants).not.toContain("tpx.connections.connections.reveal_secret");

    const members = await service.listMembers(ada);
    expect(members.map((m) => `${m.userId}:${m.roles.join("+")}`).sort()).toEqual([
      `ada:${ROLE_IDS.owner}`,
      `bob:${ROLE_IDS.member}`,
      `cat:${ROLE_IDS.admin}`,
    ]);
    expect(members.find((m) => m.userId === "bob")?.email).toBe("bob@example.test");
    expect(await status(service.listMembers({ ...ada, grants: [] }))).toBe(403);

    // Removal sweeps the membership and every grant inside the tenant; the last owner cannot go.
    await service.removeMember(ada, "bob");
    bob = await tenantCtx("bob", tenantId);
    expect(bob.grants).toEqual([]);
    expect((await service.ensureUser({ userId: "bob" })).tenants.map((t) => t.id)).not.toContain(tenantId);
    expect(await status(service.removeMember(ada, "ada"))).toBe(409);
    expect(await status(service.removeMember(ada, "nobody"))).toBe(404);

    const revokable = await service.inviteMember(ada, { email: "eve@example.test", roleId: ROLE_IDS.viewer });
    if (revokable.kind !== "invited") throw new Error("expected an invitation");
    await service.revokeInvite(ada, revokable.invite.id);
    expect(await service.listInvites(ada)).toEqual([]);
    expect((await signIn("eve", "eve@example.test", "Eve")).tenants[0]!.name).toBe("Eve's Org");
  });

  it("forgets a user the identity provider deleted", async () => {
    const tenantId = await bootstrap();
    const ada = await tenantCtx("ada", tenantId);
    await signIn("bob", "bob@example.test", "Bob");
    await service.inviteMember(ada, { email: "bob@example.test", roleId: ROLE_IDS.member });
    await service.forgetUser("bob");
    expect((await service.listMembers(ada)).map((m) => m.userId)).toEqual(["ada"]);
    expect((await tenantCtx("bob", tenantId)).grants).toEqual([]);
  });

  it("keeps tenants apart", async () => {
    const orgA = await bootstrap();
    const orgB = (await signIn("bea")).tenants[0]!.id;
    const adaInB = await tenantCtx("ada", orgB);
    expect(adaInB.grants).toEqual([]);
    expect(await service.listProjects(adaInB)).toEqual([]);
    expect(await status(service.listGrants(adaInB))).toBe(403);
    expect(await service.resolveScope({ tenantId: orgB, projectSlug: "default", environmentName: "dev" })).toBeNull();
    expect(orgA).not.toBe(orgB);
  });
});

describe("projects and environments", () => {
  it("creates projects with the default environments and enforces the vocabulary", async () => {
    const org_a = await bootstrap();
    const ada = await tenantCtx("ada", org_a);
    const project = await service.createProject(ada, { name: "Client Site" });
    expect(project.slug).toBe("client-site");
    const scope = await service.resolveScope({ tenantId: org_a, projectSlug: "client-site", environmentName: null });
    expect(scope?.environments.map((e) => e.name)).toEqual(["prod"]);
    expect(await status(service.createProject(ada, { name: "Dup", slug: "client-site" }))).toBe(409);
    expect(await status(service.createProject(ada, { name: "Bad", environments: ["staging"] }))).toBe(400);
    expect(await status(service.createProject({ ...ada, grants: [] }, { name: "Nope" }))).toBe(403);
  });

  it("extends the vocabulary only deliberately, and never drops a name in use", async () => {
    const org_a = await bootstrap();
    const scope = (await service.resolveScope({ tenantId: org_a, projectSlug: "default", environmentName: null }))!;
    const ada = await scopedCtx("ada", org_a, scope.project.id, scope.environment.id);
    expect(await status(service.addEnvironment(ada, { name: "dev" }))).toBe(400);
    const dev = await service.addEnvironment(ada, { name: "dev", extendVocabulary: true });
    expect(dev.name).toBe("dev");
    expect((await service.getTenant(await tenantCtx("ada", org_a))).environments).toEqual(["prod", "dev"]);
    expect(await status(service.addEnvironment(ada, { name: "dev" }))).toBe(409);

    const tctx = await tenantCtx("ada", org_a);
    expect(
      await status(service.updateTenantEnvironments(tctx, { environments: ["prod"], projectDefaults: ["prod"] })),
    ).toBe(409);
    const updated = await service.updateTenantEnvironments(tctx, {
      environments: ["prod", "dev", "stage"],
      projectDefaults: ["prod", "dev"],
    });
    expect(updated.projectDefaults).toEqual(["prod", "dev"]);
    const p2 = await service.createProject(tctx, { name: "Two" });
    expect(
      (await service.resolveScope({ tenantId: org_a, projectSlug: p2.slug, environmentName: null }))?.environments.map(
        (e) => e.name,
      ),
    ).toEqual(["prod", "dev"]);
  });

  it("a project-scoped admin manages their project but not the tenant", async () => {
    const org_a = await bootstrap();
    const ada = await tenantCtx("ada", org_a);
    const p1 = await service.createProject(ada, { name: "One" });
    await service.createProject(ada, { name: "Two" });
    await service.createGrant(ada, { subject: "user:carl", roleId: ROLE_IDS.admin, scope: projectScope(p1.id) });

    const carlTenant = await tenantCtx("carl", org_a);
    expect((await service.listProjects(carlTenant)).map((p) => p.slug)).toEqual(["one"]);
    expect(await status(service.createProject(carlTenant, { name: "Three" }))).toBe(403);

    const s1 = (await service.resolveScope({ tenantId: org_a, projectSlug: "one", environmentName: null }))!;
    const carlInOne = await scopedCtx("carl", org_a, s1.project.id, s1.environment.id);
    expect((await service.updateProject(carlInOne, { name: "One renamed" })).name).toBe("One renamed");
    expect(await status(service.deleteProject(carlInOne))).toBe(403);

    const s2 = (await service.resolveScope({ tenantId: org_a, projectSlug: "two", environmentName: null }))!;
    const carlInTwo = await scopedCtx("carl", org_a, s2.project.id, s2.environment.id);
    expect(carlInTwo.grants).toEqual([]);
    expect(await status(service.listEnvironments(carlInTwo))).toBe(403);
  });

  it("deleting a project sweeps its scopes' grants", async () => {
    const org_a = await bootstrap();
    const ada = await tenantCtx("ada", org_a);
    const p1 = await service.createProject(ada, { name: "One" });
    await service.createGrant(ada, { subject: "user:carl", roleId: ROLE_IDS.viewer, scope: projectScope(p1.id) });
    const s1 = (await service.resolveScope({ tenantId: org_a, projectSlug: "one", environmentName: null }))!;
    const adaInOne = await scopedCtx("ada", org_a, s1.project.id, s1.environment.id);
    await service.deleteProject(adaInOne);
    expect(await service.resolveScope({ tenantId: org_a, projectSlug: "one", environmentName: null })).toBeNull();
    expect((await service.listGrants(ada)).some((g) => g.subject === "user:carl")).toBe(false);
  });
});

describe("grants", () => {
  it("validates scope and subject against the tenant and refuses to orphan a tenant", async () => {
    const org_a = await bootstrap();
    const org_b = (await signIn("bea")).tenants[0]!.id;
    const ada = await tenantCtx("ada", org_a);
    expect(
      await status(service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: tenantScope(org_b) })),
    ).toBe(403);
    expect(
      await status(
        service.createGrant(ada, { subject: "org:org_b", roleId: ROLE_IDS.viewer, scope: tenantScope(org_a) }),
      ),
    ).toBe(403);
    expect(
      await status(service.createGrant(ada, { subject: "user:x", roleId: "nope", scope: tenantScope(org_a) })),
    ).toBe(400);
    expect(
      await status(service.createGrant(ada, { subject: "user:x", pattern: "tpx.nope.*", scope: tenantScope(org_a) })),
    ).toBe(400);
    expect(await status(service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: "*" }))).toBe(
      403,
    );

    const owner = (await service.listGrants(ada)).find((g) => g.roleId === ROLE_IDS.owner)!;
    expect(await status(service.deleteGrant(ada, owner.id))).toBe(409);
    const second = await service.createGrant(ada, {
      subject: "user:zed",
      roleId: ROLE_IDS.owner,
      scope: tenantScope(org_a),
    });
    await service.deleteGrant(ada, owner.id); // ada steps down; zed remains
    const zed = await tenantCtx("zed", org_a);
    expect(await status(service.deleteGrant(zed, second.id))).toBe(409);

    // A stale context cannot widen: ada's ctx still claims manage_grants, but the fresh check denies.
    expect(
      await status(service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: tenantScope(org_a) })),
    ).toBe(403);

    const audit = await service.listAudit(zed, { limit: 50 });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["tenant.create", "project.create", "grant.create", "grant.delete"]),
    );
    expect(await status(service.listAudit({ ...zed, grants: [] }))).toBe(403);
  });

  it("serves closure data, ancestry and the epoch to tpx-web", async () => {
    const org_a = await bootstrap();
    const access = await service.getSubjectAccess({ userId: "ada" });
    expect(access.closure).toContain("user:ada");
    expect(access.grants.some((g) => g.roleId === ROLE_IDS.owner)).toBe(true);
    const scope = (await service.resolveScope({ tenantId: org_a, projectSlug: "default", environmentName: null }))!;
    expect(await service.resolveAncestors(environmentScope(scope.environment.id))).toEqual([
      projectScope(scope.project.id),
      tenantScope(org_a),
      "*",
    ]);
    expect(await service.resolveAncestors(environmentScope("env_gone"))).toEqual(["*"]);
    const head = await service.epochHead();
    expect(head).toBeGreaterThan(0);
    const since = await service.epochSince(0, 10);
    expect("events" in since && since.events.length).toBeGreaterThan(0);
    expect(await status(service.getSubjectAccess({ nope: 1 } as never))).toBe(400);
  });
});

describe("json surface (behind the shell's /api/workspace forwarder)", () => {
  it("echoes the resolved context on /whoami and knows nothing else", async () => {
    const ctx: Ctx = {
      tenantId: "tnt_a",
      projectId: "prj",
      environmentId: "env",
      environmentName: "prod",
      userId: "ada",
      grants: ["tpx.workspace.projects.read"],
    };
    const ok = await service.handle(ctx, new Request("https://workspace.internal/whoami"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(ctx);
    expect((await service.handle(ctx, new Request("https://workspace.internal/anything"))).status).toBe(404);
    expect(
      (await service.handle(ctx, new Request("https://workspace.internal/whoami", { method: "POST" }))).status,
    ).toBe(404);
    await expect(
      service.handle({ nope: 1 } as never, new Request("https://workspace.internal/whoami")),
    ).rejects.toThrow();
  });
});
