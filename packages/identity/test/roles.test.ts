import { patternMatchesKey } from "@alfiz/core";
import { describe, expect, it } from "vitest";
import { catalog } from "../src/catalog.ts";
import { ROLE_IDS, ensureSeedRoles, seedRoles } from "../src/roles.ts";
import { makeHarness } from "./harness.ts";

const byId = new Map<string, ReturnType<typeof seedRoles>[number]>(seedRoles().map((r) => [r.id, r]));
const holds = (roleId: string, key: string) => byId.get(roleId)!.patterns.some((p) => patternMatchesKey(p, key));

describe("seed roles", () => {
  it("owner is forward-inclusive over the namespace", () => {
    expect(byId.get(ROLE_IDS.owner)?.patterns).toEqual(["tpx.*"]);
  });
  it("admin never deletes or reveals", () => {
    expect(holds(ROLE_IDS.admin, "tpx.connections.connections.delete")).toBe(false);
    expect(holds(ROLE_IDS.admin, "tpx.workspace.projects.delete")).toBe(false);
    expect(holds(ROLE_IDS.admin, "tpx.connections.connections.reveal_secret")).toBe(false);
    expect(holds(ROLE_IDS.admin, "tpx.workspace.access.manage_grants")).toBe(true);
    expect(holds(ROLE_IDS.admin, "tpx.connections.marketplace.create_connection")).toBe(true);
  });
  it("member acts within a project but never on tenant credentials", () => {
    expect(holds(ROLE_IDS.member, "tpx.connections.attachments.attach_connection")).toBe(true);
    expect(holds(ROLE_IDS.member, "tpx.connections.bindings.update_binding")).toBe(true);
    expect(holds(ROLE_IDS.member, "tpx.connections.bindings.promote_binding")).toBe(false);
    expect(holds(ROLE_IDS.member, "tpx.connections.marketplace.create_connection")).toBe(false);
    expect(holds(ROLE_IDS.member, "tpx.connections.connections.rotate_credential")).toBe(false);
    expect(holds(ROLE_IDS.member, "tpx.workspace.access.manage_grants")).toBe(false);
  });
  it("viewer holds every read and nothing else", () => {
    for (const key of catalog.ownedKeys) {
      expect(holds(ROLE_IDS.viewer, key), key).toBe(catalog.leaf(key)?.kind === "read");
    }
  });
  it("seeds idempotently and repairs drift", async () => {
    const { app } = await makeHarness();
    expect(await ensureSeedRoles(app)).toEqual({ created: [], updated: [] });
    await app.updateRole(ROLE_IDS.viewer, { patterns: ["tpx.*"] }, { kind: "system" });
    expect((await ensureSeedRoles(app)).updated).toEqual([ROLE_IDS.viewer]);
    const viewer = (await app.listRoles()).find((r) => r.id === ROLE_IDS.viewer);
    expect(viewer?.patterns).not.toContain("tpx.*");
  });
});
