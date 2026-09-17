import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { environmentScope, grantsAt, projectScope, tenantScope, ROLE_IDS, decodeRpcError } from "@tpx/identity";
import { CTX_HEADER, encodeCtxHeader, type Ctx, type TenantCtx } from "@tpx/contracts/scope";
import { AuthService, __setStoreForTests, getAlfiz, memoryStore, type AuthEnv } from "../../src/index.ts";
import type { AuthStore } from "../../src/store/types.ts";

let store: AuthStore;
let service: AuthService;

beforeEach(() => {
  store = memoryStore();
  __setStoreForTests(store);
  service = new AuthService(createExecutionContext(), env as unknown as AuthEnv);
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
    const err = decodeRpcError(e) as { status?: number };
    return err.status ?? -1;
  }
}

describe("tenant bootstrap", () => {
  it("creates the tenant with a prod-only vocabulary, a default project, and an owner", async () => {
    const tenant = await service.ensureTenant({ orgId: "org_a", name: "Ada's Org", creatorUserId: "ada" });
    expect(tenant).toMatchObject({ id: "org_a", environments: ["prod"], projectDefaults: ["prod"], createdBy: "ada" });
    const again = await service.ensureTenant({ orgId: "org_a", name: "Renamed", creatorUserId: "someone-else" });
    expect(again.name).toBe("Ada's Org");

    expect(await service.findTenant("org_missing")).toBeNull();
    expect((await service.findTenant("org_a"))?.name).toBe("Ada's Org");
    const scope = await service.resolveScope({ tenantId: "org_a", projectSlug: "default", environmentName: null });
    expect(scope?.project.name).toBe("Default");
    expect(scope?.environment.name).toBe("prod");
    expect(scope?.environments).toHaveLength(1);

    const ctx = await tenantCtx("ada", "org_a");
    expect(ctx.grants).toContain("tpx.workspace.access.manage_grants");
    expect(ctx.grants).toContain("tpx.workspace.projects.delete");
    const grants = await service.listGrants(ctx);
    expect(grants.map((g) => `${g.subject}:${g.roleId}`).sort()).toEqual([
      `org:org_a:${ROLE_IDS.member}`,
      `user:ada:${ROLE_IDS.owner}`,
    ]);
  });

  it("makes every org member a member and mirrors Clerk admins, reversibly", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "Acme", creatorUserId: "ada" });
    await service.ensureUser({ userId: "bob", orgId: "org_a", orgRole: "org:member" });
    let bob = await tenantCtx("bob", "org_a");
    expect(bob.grants).toContain("tpx.connections.attachments.attach_connection");
    expect(bob.grants).not.toContain("tpx.workspace.access.manage_grants");

    await service.ensureUser({ userId: "bob", orgId: "org_a", orgRole: "org:admin" });
    bob = await tenantCtx("bob", "org_a");
    expect(bob.grants).toContain("tpx.workspace.access.manage_grants");
    expect(bob.grants).not.toContain("tpx.connections.connections.reveal_secret");

    // Demotion in Clerk removes exactly the mirrored grant.
    await service.ensureUser({ userId: "bob", orgId: "org_a", orgRole: "org:member" });
    bob = await tenantCtx("bob", "org_a");
    expect(bob.grants).not.toContain("tpx.workspace.access.manage_grants");

    // Leaving the org removes the membership and any tenant grants.
    await service.removeMember({ orgId: "org_a", userId: "bob" });
    bob = await tenantCtx("bob", "org_a");
    expect(bob.grants).toEqual([]);
  });

  it("keeps tenants apart", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    await service.ensureTenant({ orgId: "org_b", name: "B", creatorUserId: "bea" });
    const adaInB = await tenantCtx("ada", "org_b");
    expect(adaInB.grants).toEqual([]);
    expect(await service.listProjects(adaInB)).toEqual([]);
    expect(await status(service.listGrants(adaInB))).toBe(403);
    expect(
      await service.resolveScope({ tenantId: "org_b", projectSlug: "default", environmentName: "dev" }),
    ).toBeNull();
  });
});

describe("projects and environments", () => {
  it("creates projects with the default environments and enforces the vocabulary", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    const ada = await tenantCtx("ada", "org_a");
    const project = await service.createProject(ada, { name: "Client Site" });
    expect(project.slug).toBe("client-site");
    const scope = await service.resolveScope({ tenantId: "org_a", projectSlug: "client-site", environmentName: null });
    expect(scope?.environments.map((e) => e.name)).toEqual(["prod"]);
    expect(await status(service.createProject(ada, { name: "Dup", slug: "client-site" }))).toBe(409);
    expect(await status(service.createProject(ada, { name: "Bad", environments: ["staging"] }))).toBe(400);
    expect(await status(service.createProject({ ...ada, grants: [] }, { name: "Nope" }))).toBe(403);
  });

  it("extends the vocabulary only deliberately, and never drops a name in use", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    const scope = (await service.resolveScope({ tenantId: "org_a", projectSlug: "default", environmentName: null }))!;
    const ada = await scopedCtx("ada", "org_a", scope.project.id, scope.environment.id);
    expect(await status(service.addEnvironment(ada, { name: "dev" }))).toBe(400);
    const dev = await service.addEnvironment(ada, { name: "dev", extendVocabulary: true });
    expect(dev.name).toBe("dev");
    expect((await service.getTenant(await tenantCtx("ada", "org_a"))).environments).toEqual(["prod", "dev"]);
    expect(await status(service.addEnvironment(ada, { name: "dev" }))).toBe(409);

    const tctx = await tenantCtx("ada", "org_a");
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
      (
        await service.resolveScope({ tenantId: "org_a", projectSlug: p2.slug, environmentName: null })
      )?.environments.map((e) => e.name),
    ).toEqual(["prod", "dev"]);
  });

  it("a project-scoped admin manages their project but not the tenant", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    const ada = await tenantCtx("ada", "org_a");
    const p1 = await service.createProject(ada, { name: "One" });
    await service.createProject(ada, { name: "Two" });
    await service.createGrant(ada, { subject: "user:carl", roleId: ROLE_IDS.admin, scope: projectScope(p1.id) });

    const carlTenant = await tenantCtx("carl", "org_a");
    expect((await service.listProjects(carlTenant)).map((p) => p.slug)).toEqual(["one"]);
    expect(await status(service.createProject(carlTenant, { name: "Three" }))).toBe(403);

    const s1 = (await service.resolveScope({ tenantId: "org_a", projectSlug: "one", environmentName: null }))!;
    const carlInOne = await scopedCtx("carl", "org_a", s1.project.id, s1.environment.id);
    expect((await service.updateProject(carlInOne, { name: "One renamed" })).name).toBe("One renamed");
    expect(await status(service.deleteProject(carlInOne))).toBe(403);

    const s2 = (await service.resolveScope({ tenantId: "org_a", projectSlug: "two", environmentName: null }))!;
    const carlInTwo = await scopedCtx("carl", "org_a", s2.project.id, s2.environment.id);
    expect(carlInTwo.grants).toEqual([]);
    expect(await status(service.listEnvironments(carlInTwo))).toBe(403);
  });

  it("deleting a project sweeps its scopes' grants", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    const ada = await tenantCtx("ada", "org_a");
    const p1 = await service.createProject(ada, { name: "One" });
    await service.createGrant(ada, { subject: "user:carl", roleId: ROLE_IDS.viewer, scope: projectScope(p1.id) });
    const s1 = (await service.resolveScope({ tenantId: "org_a", projectSlug: "one", environmentName: null }))!;
    const adaInOne = await scopedCtx("ada", "org_a", s1.project.id, s1.environment.id);
    await service.deleteProject(adaInOne);
    expect(await service.resolveScope({ tenantId: "org_a", projectSlug: "one", environmentName: null })).toBeNull();
    expect((await service.listGrants(ada)).some((g) => g.subject === "user:carl")).toBe(false);
  });
});

describe("grants", () => {
  it("validates scope and subject against the tenant and refuses to orphan a tenant", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    await service.ensureTenant({ orgId: "org_b", name: "B", creatorUserId: "bea" });
    const ada = await tenantCtx("ada", "org_a");
    expect(
      await status(
        service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: tenantScope("org_b") }),
      ),
    ).toBe(403);
    expect(
      await status(
        service.createGrant(ada, { subject: "org:org_b", roleId: ROLE_IDS.viewer, scope: tenantScope("org_a") }),
      ),
    ).toBe(403);
    expect(
      await status(service.createGrant(ada, { subject: "user:x", roleId: "nope", scope: tenantScope("org_a") })),
    ).toBe(400);
    expect(
      await status(service.createGrant(ada, { subject: "user:x", pattern: "tpx.nope.*", scope: tenantScope("org_a") })),
    ).toBe(400);
    expect(await status(service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: "*" }))).toBe(
      403,
    );

    const owner = (await service.listGrants(ada)).find((g) => g.roleId === ROLE_IDS.owner)!;
    expect(await status(service.deleteGrant(ada, owner.id))).toBe(409);
    const second = await service.createGrant(ada, {
      subject: "user:zed",
      roleId: ROLE_IDS.owner,
      scope: tenantScope("org_a"),
    });
    await service.deleteGrant(ada, owner.id); // ada steps down; zed remains
    const zed = await tenantCtx("zed", "org_a");
    expect(await status(service.deleteGrant(zed, second.id))).toBe(409);

    // A stale context cannot widen: ada's ctx still claims manage_grants, but the fresh check denies.
    expect(
      await status(
        service.createGrant(ada, { subject: "user:x", roleId: ROLE_IDS.viewer, scope: tenantScope("org_a") }),
      ),
    ).toBe(403);

    const audit = await service.listAudit(zed, { limit: 50 });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["tenant.create", "project.create", "grant.create", "grant.delete"]),
    );
    expect(await status(service.listAudit({ ...zed, grants: [] }))).toBe(403);
  });

  it("serves closure data, ancestry and the epoch to tpx-web", async () => {
    await service.ensureTenant({ orgId: "org_a", name: "A", creatorUserId: "ada" });
    const access = await service.getSubjectAccess({ userId: "ada" });
    expect(access.closure).toContain("user:ada");
    expect(access.grants.some((g) => g.roleId === ROLE_IDS.owner)).toBe(true);
    const scope = (await service.resolveScope({ tenantId: "org_a", projectSlug: "default", environmentName: null }))!;
    expect(await service.resolveAncestors(environmentScope(scope.environment.id))).toEqual([
      projectScope(scope.project.id),
      tenantScope("org_a"),
      "*",
    ]);
    expect(await service.resolveAncestors(environmentScope("env_gone"))).toEqual(["*"]);
    const head = await service.epochHead();
    expect(head).toBeGreaterThan(0);
    const since = await service.epochSince(0, 10);
    expect("events" in since && since.events.length).toBeGreaterThan(0);
    expect(await status(service.getSubjectAccess({ nope: 1 } as never))).toBe(400);
  });

  it("answers health over fetch and nothing else without a context", async () => {
    const ok = await service.fetch(new Request("https://tpx-auth/healthz"));
    expect(ok.status).toBe(200);
    expect((await service.fetch(new Request("https://tpx-auth/anything"))).status).toBe(401);
    expect(
      (await service.fetch(new Request("https://tpx-auth/anything", { headers: { "x-tpx-ctx": "garbage" } }))).status,
    ).toBe(401);
  });
});

describe("http surface (behind the tpx-web forwarder)", () => {
  it("echoes the delivered context on /whoami and refuses requests without one", async () => {
    const ctx: Ctx = {
      tenantId: "org_a",
      projectId: "prj",
      environmentId: "env",
      environmentName: "prod",
      userId: "ada",
      grants: ["tpx.workspace.projects.read"],
    };
    const ok = await service.fetch(
      new Request("https://auth.internal/whoami", { headers: { [CTX_HEADER]: encodeCtxHeader(ctx) } }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(ctx);
    expect((await service.fetch(new Request("https://auth.internal/whoami"))).status).toBe(401);
    expect((await service.fetch(new Request("https://auth.internal/healthz"))).status).toBe(200);
  });
});
