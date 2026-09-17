import { lintCatalog } from "@alfiz/core";
import { describe, expect, it } from "vitest";
import { catalog, productOfKey } from "../src/catalog.ts";
import { environmentScope, parseTpxScope, projectScope, tenantScope } from "../src/scopes.ts";

describe("catalog", () => {
  it("passes Alfiz's catalog lint with no errors", () => {
    const issues = lintCatalog(catalog).filter((i) => i.severity === "error");
    expect(issues).toEqual([]);
  });

  it("owns exactly the tpx namespace at depth 4", () => {
    expect(catalog.namespace).toBe("tpx");
    for (const key of catalog.ownedKeys) expect(key.split(".").length).toBe(4);
  });

  it("declares the three scope types as a chain", () => {
    expect(catalog.scopeTypes.get("tpx.tenant")?.parent).toBeNull();
    expect(catalog.scopeTypes.get("tpx.project")?.parent).toBe("tpx.tenant");
    expect(catalog.scopeTypes.get("tpx.environment")?.parent).toBe("tpx.project");
  });

  it("keeps tenant-only actions out of reach of project and environment grants", () => {
    for (const key of [
      "tpx.connections.marketplace.create_connection",
      "tpx.connections.connections.reveal_secret",
      "tpx.connections.connections.delete",
      "tpx.workspace.access.manage_grants",
    ]) {
      expect(catalog.appliesAt(key, tenantScope("t"))).toBe(true);
      expect(catalog.appliesAt(key, projectScope("p"))).toBe(false);
      expect(catalog.appliesAt(key, environmentScope("e"))).toBe(false);
    }
    expect(catalog.appliesAt("tpx.connections.bindings.update_binding", environmentScope("e"))).toBe(true);
  });

  it("marks deletes destructive and reads as reads", () => {
    expect(catalog.leaf("tpx.connections.connections.delete")?.destructive).toBe(true);
    expect(catalog.leaf("tpx.connections.connections.read")?.kind).toBe("read");
    expect(catalog.leaf("tpx.connections.connections.rotate_credential")?.kind).toBe("action");
  });

  it("maps keys to products and parses scope ids", () => {
    expect(productOfKey("tpx.connections.bindings.read")).toBe("connections");
    expect(productOfKey("alfiz_internal.access.read")).toBeNull();
    expect(parseTpxScope(environmentScope("e1"))).toEqual({ level: "environment", environmentId: "e1" });
    expect(parseTpxScope("*")).toEqual({ level: "global" });
    expect(parseTpxScope("docs.doc:1")).toBeNull();
  });
});
