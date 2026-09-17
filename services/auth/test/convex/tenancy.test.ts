import { describe, expect, it } from "vitest";
import { freshStore } from "./harness";

describe("convex store — tenancy", () => {
  it("round-trips tenants, projects, environments and audit", async () => {
    const { store } = freshStore();
    const t = store.tenancy;
    expect(
      await t.insertTenant({
        id: "org_1",
        name: "Acme",
        environments: ["prod", "dev"],
        projectDefaults: ["prod"],
        createdBy: "u1",
        createdAt: 1,
      }),
    ).toBe(true);
    expect(
      await t.insertTenant({
        id: "org_1",
        name: "Dup",
        environments: ["prod"],
        projectDefaults: ["prod"],
        createdBy: "u1",
        createdAt: 2,
      }),
    ).toBe(false);
    expect((await t.getTenant("org_1"))?.name).toBe("Acme");

    const project = { id: "prj_1", tenantId: "org_1", slug: "site", name: "Site", createdAt: 10, archivedAt: null };
    const envs = [
      { id: "env_1", tenantId: "org_1", projectId: "prj_1", name: "prod", createdAt: 10 },
      { id: "env_2", tenantId: "org_1", projectId: "prj_1", name: "dev", createdAt: 11 },
    ];
    expect(await t.insertProject(project, envs)).toBe(true);
    expect(await t.insertProject({ ...project, id: "prj_2" }, [])).toBe(false);
    expect(await t.getProjectBySlug("org_1", "site")).toEqual(project);
    expect(await t.getProject("org_other", "prj_1")).toBeNull();
    expect((await t.listEnvironments("org_1", "prj_1")).map((e) => e.name)).toEqual(["prod", "dev"]);
    expect(
      await t.insertEnvironment({ id: "env_3", tenantId: "org_1", projectId: "prj_1", name: "dev", createdAt: 12 }),
    ).toBe(false);
    expect((await t.getEnvironmentById("env_2"))?.projectId).toBe("prj_1");

    await t.updateProject("org_1", "prj_1", { name: "Client site", archivedAt: 99 });
    expect(await t.getProject("org_1", "prj_1")).toMatchObject({ name: "Client site", archivedAt: 99 });
    await t.updateTenantVocabulary("org_1", ["prod", "dev", "stage"], ["prod", "dev"]);
    expect((await t.getTenant("org_1"))?.environments).toEqual(["prod", "dev", "stage"]);

    await t.recordAudit({ id: "aud_1", tenantId: "org_1", at: 5, actor: "u1", action: "x", target: "y" });
    await t.recordAudit({
      id: "aud_2",
      tenantId: "org_1",
      at: 6,
      actor: "u1",
      action: "z",
      target: "y",
      detail: { n: 1 },
    });
    await t.recordAudit({ id: "aud_3", tenantId: "org_2", at: 7, actor: "u9", action: "z", target: "y" });
    const audit = await t.listTenantAudit("org_1", 10);
    expect(audit.map((a) => a.id)).toEqual(["aud_2", "aud_1"]);
    expect(audit[0]?.detail).toEqual({ n: 1 });

    await t.deleteProject("org_1", "prj_1");
    expect(await t.getProjectById("prj_1")).toBeNull();
    expect(await t.listTenantEnvironments("org_1")).toEqual([]);
  });

  it("lists grants across a tenant's scopes", async () => {
    const { store } = freshStore();
    const base = { provenance: { kind: "system" as const }, createdAt: 1 };
    await store.alfiz.insertGrant({ id: "g1", subject: "user:a", roleId: "r", scope: "tpx.tenant:t1", ...base });
    await store.alfiz.insertGrant({ id: "g2", subject: "user:b", pattern: "tpx.*", scope: "tpx.project:p1", ...base });
    await store.alfiz.insertGrant({ id: "g3", subject: "user:c", roleId: "r", scope: "tpx.tenant:t2", ...base });
    const rows = await store.listGrantsInScopes(["tpx.tenant:t1", "tpx.project:p1"]);
    expect(rows.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
  });
});
