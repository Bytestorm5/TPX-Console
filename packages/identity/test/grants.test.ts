import { userSubject, orgSubject } from "@alfiz/core";
import { describe, expect, it } from "vitest";
import { decodeRpcError, ForbiddenError, type TpxError } from "../src/errors.ts";
import { grantsAt, hasGrant, productsWithGrants, requireGrant } from "../src/grants.ts";
import { ROLE_IDS } from "../src/roles.ts";
import { environmentScope, projectScope, tenantScope } from "../src/scopes.ts";
import { makeHarness, PROVENANCE } from "./harness.ts";

async function scenario() {
  const h = await makeHarness();
  h.addTenant("t1");
  h.addProject("t1", "p1");
  h.addProject("t1", "p2");
  h.addEnvironment("p1", "p1-prod");
  h.addEnvironment("p1", "p1-dev");
  h.addEnvironment("p2", "p2-prod");
  h.addTenant("t2");
  h.addProject("t2", "p3");
  h.addEnvironment("p3", "p3-prod");
  return h;
}

async function grantsFor(h: Awaited<ReturnType<typeof makeHarness>>, userId: string, scope: string) {
  const snap = await h.client.snapshot({ userId }, { scopes: [scope], fresh: true });
  return grantsAt(snap, scope);
}

describe("grants at a scope", () => {
  it("an owner granted at the tenant holds everything in every environment of every project", async () => {
    const h = await scenario();
    await h.app.createGrant({
      subject: userSubject("owner"),
      roleId: ROLE_IDS.owner,
      scope: tenantScope("t1"),
      provenance: PROVENANCE,
    });
    const inP1 = await grantsFor(h, "owner", environmentScope("p1-dev"));
    const inP2 = await grantsFor(h, "owner", environmentScope("p2-prod"));
    expect(inP1).toContain("tpx.connections.marketplace.create_connection");
    expect(inP1).toContain("tpx.connections.connections.reveal_secret");
    expect(inP1).toContain("tpx.workspace.projects.delete");
    expect(inP2).toEqual(inP1);
    // …but nothing in another tenant.
    expect(await grantsFor(h, "owner", environmentScope("p3-prod"))).toEqual([]);
  });

  it("a project-scoped admin acts inside that project only, and never on tenant-only actions", async () => {
    const h = await scenario();
    await h.app.createGrant({
      subject: userSubject("contractor"),
      roleId: ROLE_IDS.admin,
      scope: projectScope("p1"),
      provenance: PROVENANCE,
    });
    const inP1 = await grantsFor(h, "contractor", environmentScope("p1-prod"));
    expect(inP1).toContain("tpx.connections.attachments.attach_connection");
    expect(inP1).toContain("tpx.connections.bindings.update_binding");
    expect(inP1).toContain("tpx.workspace.projects.read");
    expect(inP1).not.toContain("tpx.connections.marketplace.create_connection");
    expect(inP1).not.toContain("tpx.workspace.access.manage_grants");
    expect(await grantsFor(h, "contractor", environmentScope("p2-prod"))).toEqual([]);
    // At the tenant scope itself, a project grant confers nothing.
    expect(await grantsFor(h, "contractor", tenantScope("t1"))).toEqual([]);
  });

  it("an environment-scoped grant does not reach a sibling environment", async () => {
    const h = await scenario();
    await h.app.createGrant({
      subject: userSubject("dev"),
      roleId: ROLE_IDS.member,
      scope: environmentScope("p1-dev"),
      provenance: PROVENANCE,
    });
    expect(await grantsFor(h, "dev", environmentScope("p1-dev"))).toContain("tpx.connections.bindings.update_binding");
    expect(await grantsFor(h, "dev", environmentScope("p1-prod"))).toEqual([]);
  });

  it("every org member is a viewer through the org subject; a personal revoke wins", async () => {
    const h = await scenario();
    await h.app.importDirectory({ users: [{ userId: "alice" }], orgs: { alice: ["t1"] } }, "test");
    await h.app.createGrant({
      subject: orgSubject("t1"),
      roleId: ROLE_IDS.viewer,
      scope: tenantScope("t1"),
      provenance: PROVENANCE,
    });
    const before = await grantsFor(h, "alice", environmentScope("p1-prod"));
    expect(before).toContain("tpx.connections.connections.read");
    expect(before).not.toContain("tpx.connections.attachments.attach_connection");
    await h.app.createRevoke({
      userId: "alice",
      pattern: "tpx.connections.*",
      scope: projectScope("p1"),
      provenance: PROVENANCE,
    });
    const after = await grantsFor(h, "alice", environmentScope("p1-prod"));
    expect(after).not.toContain("tpx.connections.connections.read");
    expect(after).toContain("tpx.workspace.projects.read");
    expect(await grantsFor(h, "alice", environmentScope("p2-prod"))).toContain("tpx.connections.connections.read");
  });

  it("an inactive user holds nothing", async () => {
    const h = await scenario();
    await h.app.createGrant({
      subject: userSubject("gone"),
      roleId: ROLE_IDS.owner,
      scope: tenantScope("t1"),
      provenance: PROVENANCE,
    });
    await h.app.setUserActive("gone", false, PROVENANCE);
    expect(await grantsFor(h, "gone", environmentScope("p1-prod"))).toEqual([]);
  });
});

describe("pure enforcement", () => {
  const ctx = { grants: ["tpx.connections.connections.read", "tpx.operator.overview.read"] };
  it("requireGrant throws a 403 with the permission named", () => {
    expect(hasGrant(ctx, "tpx.connections.connections.read")).toBe(true);
    expect(() => requireGrant(ctx, "tpx.connections.connections.delete")).toThrow(ForbiddenError);
    try {
      requireGrant(ctx, "tpx.connections.connections.delete");
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403);
      expect((e as ForbiddenError).permission).toBe("tpx.connections.connections.delete");
    }
  });
  it("refuses undeclared keys as programming errors, not denials", () => {
    expect(() => requireGrant(ctx, "tpx.connections.connections.nope" as never)).toThrow(/unknown permission/);
  });
  it("lists the products a grant set touches", () => {
    expect([...productsWithGrants(ctx.grants)].sort()).toEqual(["connections", "operator"]);
  });
  it("restores typed errors after an RPC hop", () => {
    const hopped = new Error(new ForbiddenError("missing x", "x").message);
    const restored = decodeRpcError(hopped);
    expect(restored).toBeInstanceOf(ForbiddenError);
    expect((restored as TpxError).status).toBe(403);
    expect((restored as TpxError).detail).toBe("missing x");
    const plain = new Error("boom");
    expect(decodeRpcError(plain)).toBe(plain);
  });
});
