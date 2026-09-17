import { describe, expect, it } from "vitest";
import {
  CtxSchema,
  EnvironmentNameSchema,
  SlugSchema,
  decodeCtxHeader,
  encodeCtxHeader,
  parseCtx,
  scopeOf,
} from "../src/scope.ts";

const ctx = {
  tenantId: "org_1",
  projectId: "prj_1",
  environmentId: "env_1",
  environmentName: "prod",
  userId: "user_1",
  grants: ["tpx.connections.marketplace.read"],
};

describe("Ctx", () => {
  it("requires every level of the scope triple", () => {
    for (const key of ["tenantId", "projectId", "environmentId", "environmentName", "userId", "grants"] as const) {
      const { [key]: _omitted, ...rest } = ctx;
      expect(CtxSchema.safeParse(rest).success, `missing ${key}`).toBe(false);
    }
    expect(parseCtx(ctx)).toEqual(ctx);
  });

  it("rejects empty ids and non-string grants", () => {
    expect(CtxSchema.safeParse({ ...ctx, tenantId: "" }).success).toBe(false);
    expect(CtxSchema.safeParse({ ...ctx, grants: [1] }).success).toBe(false);
  });

  it("round-trips through the forwarded header", () => {
    expect(decodeCtxHeader(encodeCtxHeader(ctx))).toEqual(ctx);
    expect(decodeCtxHeader(null)).toBeNull();
    expect(() => decodeCtxHeader("{}")).toThrow();
    expect(() => decodeCtxHeader("not json")).toThrow();
  });

  it("extracts the scope triple", () => {
    expect(scopeOf(ctx)).toEqual({ tenantId: "org_1", projectId: "prj_1", environmentId: "env_1" });
  });
});

describe("slugs and environment names", () => {
  it("accepts url-safe slugs only", () => {
    expect(SlugSchema.safeParse("client-site").success).toBe(true);
    expect(SlugSchema.safeParse("Client Site").success).toBe(false);
    expect(SlugSchema.safeParse("-lead").success).toBe(false);
    expect(SlugSchema.safeParse("a--b").success).toBe(false);
  });
  it("keeps environment names as vocabulary tokens", () => {
    expect(EnvironmentNameSchema.safeParse("prod").success).toBe(true);
    expect(EnvironmentNameSchema.safeParse("Prod").success).toBe(false);
    expect(EnvironmentNameSchema.safeParse("1dev").success).toBe(false);
  });
});
