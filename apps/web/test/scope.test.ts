import { describe, expect, it } from "vitest";
import { assertGrant, readScopeCookie, readThemeCookie, scopeCookieHeader } from "../src/shell/session.server.ts";
import { scopePath } from "../src/shell/scope.ts";

describe("scope paths and cookies", () => {
  it("builds scoped URLs without double slashes", () => {
    expect(scopePath("site", "production")).toBe("/site/production");
    expect(scopePath("site", "production", "connections")).toBe("/site/production/connections");
    expect(scopePath("site", "production", "/connections/c/1")).toBe("/site/production/connections/c/1");
  });

  it("round-trips the remembered scope through a hardened cookie", () => {
    const header = scopeCookieHeader("client-site", "staging");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    const request = new Request("https://console.test/", { headers: { cookie: `other=1; ${header.split(";")[0]}` } });
    expect(readScopeCookie(request)).toEqual({ project: "client-site", environment: "staging" });
  });

  it("ignores malformed or absent scope cookies", () => {
    expect(readScopeCookie(new Request("https://console.test/"))).toBeNull();
    expect(
      readScopeCookie(new Request("https://console.test/", { headers: { cookie: "tpx_scope=onlyproject" } })),
    ).toBeNull();
  });

  it("accepts only the two theme values", () => {
    expect(readThemeCookie(new Request("https://console.test/", { headers: { cookie: "tpx_theme=dark" } }))).toBe(
      "dark",
    );
    expect(readThemeCookie(new Request("https://console.test/", { headers: { cookie: "tpx_theme=blue" } }))).toBeNull();
  });
});

describe("assertGrant", () => {
  it("throws a 403 data response naming the missing key", () => {
    const ctx = { grants: ["tpx.connections.connections.read"] };
    expect(() => assertGrant(ctx, "tpx.connections.connections.read")).not.toThrow();
    try {
      assertGrant(ctx, "tpx.connections.connections.reveal_secret");
      expect.unreachable();
    } catch (thrown) {
      const response = thrown as { init?: { status?: number }; data?: { error?: string } };
      expect(response.init?.status).toBe(403);
      expect(response.data?.error).toContain("tpx.connections.connections.reveal_secret");
    }
  });
});
