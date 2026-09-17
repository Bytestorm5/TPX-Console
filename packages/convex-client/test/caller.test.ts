import { anyApi } from "convex/server";
import { describe, expect, it } from "vitest";
import { ConvexCallError, compact, createConvexCaller, stripUndefined } from "../src/index.ts";

describe("createConvexCaller", () => {
  it("posts to the documented HTTP API with the deploy key and unwraps the value", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const caller = createConvexCaller({
      url: "https://example.convex.cloud/",
      deployKey: "dev:key",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ status: "success", value: { ok: 1 } }), { status: 200 });
      },
    });
    const result = await caller.query((anyApi as never as { alfiz: { getRole: never } }).alfiz.getRole, {
      id: "x",
      extra: undefined,
    } as never);
    expect(result).toEqual({ ok: 1 });
    expect(calls[0]?.url).toBe("https://example.convex.cloud/api/query");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Convex dev:key");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      path: "alfiz:getRole",
      args: { id: "x" },
      format: "json",
    });
  });

  it("surfaces Convex errors with their data", async () => {
    const caller = createConvexCaller({
      url: "https://example.convex.cloud",
      deployKey: "k",
      fetch: async () =>
        new Response(JSON.stringify({ status: "error", errorMessage: "boom", errorData: { code: 1 } }), {
          status: 400,
        }),
    });
    await expect(caller.mutation((anyApi as never as { m: { f: never } }).m.f, {} as never)).rejects.toMatchObject({
      name: "ConvexCallError",
      message: "boom",
      errorData: { code: 1 },
      path: "m:f",
    });
    expect(new ConvexCallError("p", "m").path).toBe("p");
  });

  it("strips undefined deeply and typed-compacts shallowly", () => {
    expect(stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, { f: undefined }] } })).toEqual({
      a: 1,
      c: { e: [1, {}] },
    });
    const value: { a?: string | undefined } = { a: undefined };
    expect(compact(value)).toEqual({});
  });
});
