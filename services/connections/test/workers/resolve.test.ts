import { describe, expect, it } from "vitest";
import { getProvider } from "../../src/providers/index.ts";
import { missingRequired, pickInnermost, resolveFields, type LevelValues } from "../../src/resolve.ts";

const cloudflare = getProvider("cloudflare")!.descriptor;
const level = (config: Record<string, string>, secretKeys: string[] = []): LevelValues => ({
  config,
  secrets: new Map(secretKeys.map((k) => [k, { hint: "1234", updatedAt: 1 }])),
});

describe("resolution", () => {
  it("falls back through the four levels innermost-first", () => {
    const fields = resolveFields(cloudflare, {
      base: level({ account_id: "acct", zone_id: "zone-base" }, ["api_token"]),
      environmentDefault: level({ zone_id: "zone-env" }),
      attachment: level({}),
      binding: null,
    });
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.account_id).toMatchObject({ set: true, value: "acct", suppliedBy: "connection-base" });
    expect(byKey.zone_id).toMatchObject({ set: true, value: "zone-env", suppliedBy: "connection-environment" });
    expect(byKey.api_token).toMatchObject({ set: true, suppliedBy: "connection-base", hint: "1234", secret: true });
    expect(byKey.api_token?.value).toBeUndefined();
    expect(missingRequired(fields)).toEqual([]);
  });

  it("lets a binding override everything and reports what is missing", () => {
    const fields = resolveFields(cloudflare, {
      base: level({ account_id: "acct" }),
      environmentDefault: null,
      attachment: level({ zone_id: "zone-att" }, ["api_token"]),
      binding: level({ zone_id: "zone-bind" }, ["api_token"]),
    });
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.zone_id).toMatchObject({ value: "zone-bind", suppliedBy: "binding" });
    expect(byKey.api_token).toMatchObject({ suppliedBy: "binding" });
    const bare = resolveFields(cloudflare, {
      base: level({}),
      environmentDefault: null,
      attachment: null,
      binding: null,
    });
    expect(missingRequired(bare)).toEqual(["account_id", "api_token"]);
    expect(bare.every((f) => f.suppliedBy === null)).toBe(true);
  });

  it("picks rows innermost-first per key", () => {
    const chosen = pickInnermost({
      "connection-base": [
        { key: "a", id: "base-a" },
        { key: "b", id: "base-b" },
      ],
      attachment: [{ key: "a", id: "att-a" }],
    });
    expect(chosen.get("a")).toMatchObject({ level: "attachment", row: { id: "att-a" } });
    expect(chosen.get("b")).toMatchObject({ level: "connection-base", row: { id: "base-b" } });
  });
});
