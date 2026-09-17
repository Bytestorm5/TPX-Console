import { describe, expect, it } from "vitest";
import { activeItem, buildProductGroups, buildWorkspaceGroup, isGroupActive, type NavInput } from "../src/shell/nav.ts";
import { products } from "../src/registry.ts";

const enabled = (id: string, features: string[] = []) => ({
  product: id as never,
  enabled: true,
  features,
  version: "test",
});

function input(overrides: Partial<NavInput> = {}): NavInput {
  return {
    manifests: products,
    scopeBase: "/site/production",
    grants: [
      "tpx.connections.connections.read",
      "tpx.connections.marketplace.read",
      "tpx.connections.attachments.read",
      "tpx.operator.overview.read",
    ],
    tenantGrants: [],
    capabilities: {
      connections: enabled("connections", ["marketplace", "attachments", "bindings", "promotion", "audit"]),
      operator: enabled("operator", ["preview"]),
      dispatcher: null,
      integrator: { product: "integrator", enabled: false, features: [], version: "off" },
    },
    ...overrides,
  };
}

describe("buildProductGroups", () => {
  it("renders nothing without a scope", () => {
    expect(buildProductGroups(input({ scopeBase: null }))).toEqual([]);
  });

  it("shows only enabled products the user holds a grant under, in registry order", () => {
    const groups = buildProductGroups(input());
    expect(groups.map((g) => g.id)).toEqual(["connections", "operator"]);
    expect(groups[1]?.preview).toBe(true);
    expect(groups[0]?.preview).toBe(false);
  });

  it("hides a product whose service reports it disabled or unavailable, whatever the grants", () => {
    const groups = buildProductGroups(
      input({ grants: ["tpx.integrator.overview.read", "tpx.dispatcher.overview.read"] }),
    );
    expect(groups).toEqual([]);
  });

  it("filters entries by grant and by advertised feature", () => {
    const [connections] = buildProductGroups(
      input({ capabilities: { ...input().capabilities, connections: enabled("connections", ["marketplace"]) } }),
    );
    expect(connections?.items.map((i) => i.label)).toEqual(["Connected", "Marketplace"]);
    expect(connections?.to).toBe("/site/production/connections");
    expect(connections?.base).toBe("/site/production/connections");
  });

  it("drops a product with grants but no visible entry", () => {
    const groups = buildProductGroups(input({ grants: ["tpx.connections.audit.export_audit"] }));
    expect(groups).toEqual([]);
  });

  it("carries no components through loader data", () => {
    for (const group of buildProductGroups(input())) {
      expect(JSON.parse(JSON.stringify(group))).toEqual(group);
    }
  });
});

describe("active state", () => {
  const group = {
    base: "/site/production/connections",
    items: [
      { label: "Connected", to: "/site/production/connections", path: "connections" },
      { label: "Attachments", to: "/site/production/connections/attachments", path: "connections/attachments" },
    ],
  };

  it("highlights the longest matching entry, so a detail page lights its list", () => {
    expect(activeItem(group, "/site/production/connections/attachments/att_1")).toBe(
      "/site/production/connections/attachments",
    );
    expect(activeItem(group, "/site/production/connections/c/con_1")).toBe("/site/production/connections");
    expect(activeItem(group, "/site/production")).toBeNull();
  });

  it("does not treat a sibling prefix as inside the group", () => {
    expect(isGroupActive(group, "/site/production/connections-old")).toBe(false);
    expect(isGroupActive(group, "/site/production/connections")).toBe(true);
    expect(isGroupActive(group, "/site/production/connections/audit")).toBe(true);
  });
});

describe("buildWorkspaceGroup", () => {
  it("always lists projects and gates the rest on tenant grants", () => {
    expect(buildWorkspaceGroup({ tenantGrants: [] }).items.map((i) => i.label)).toEqual(["Projects"]);
    expect(
      buildWorkspaceGroup({ tenantGrants: ["tpx.workspace.access.read", "tpx.workspace.audit.read"] }).items.map(
        (i) => i.label,
      ),
    ).toEqual(["Projects", "Access", "Audit"]);
  });
});
