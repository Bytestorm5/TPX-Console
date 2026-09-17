import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { aadFor, hintFor, loadMasterKeys, open, seal, sha256Hex, timingSafeEqual } from "../../src/crypto.ts";

const E = env as unknown as { CONNECTIONS_MASTER_KEY: string; CONNECTIONS_MASTER_KEY_PREVIOUS: string };
const aad = aadFor({
  tenantId: "org_a",
  ownerKind: "connection-base",
  ownerId: "con_1",
  environmentKey: "",
  key: "api_token",
});

describe("envelope encryption", () => {
  it("round-trips, hints, and never stores plaintext", async () => {
    const keys = await loadMasterKeys(E);
    const envelope = await seal(keys, aad, "sk_live_1234567890");
    expect(envelope.hint).toBe("7890");
    expect(envelope.keyVersion).toBe(keys.current.version);
    expect(JSON.stringify(envelope)).not.toContain("sk_live");
    expect(await open(keys, aad, envelope)).toBe("sk_live_1234567890");
  });

  it("is bound to its row: another tenant, owner or field cannot open it", async () => {
    const keys = await loadMasterKeys(E);
    const envelope = await seal(keys, aad, "value-of-eight-chars");
    for (const other of [
      aadFor({
        tenantId: "org_b",
        ownerKind: "connection-base",
        ownerId: "con_1",
        environmentKey: "",
        key: "api_token",
      }),
      aadFor({ tenantId: "org_a", ownerKind: "attachment", ownerId: "con_1", environmentKey: "", key: "api_token" }),
      aadFor({ tenantId: "org_a", ownerKind: "connection-base", ownerId: "con_1", environmentKey: "", key: "other" }),
    ]) {
      await expect(open(keys, other, envelope)).rejects.toMatchObject({ code: "secret_unavailable", status: 500 });
    }
  });

  it("detects tampering", async () => {
    const keys = await loadMasterKeys(E);
    const envelope = await seal(keys, aad, "value-of-eight-chars");
    const flipped = envelope.ciphertext.startsWith("A")
      ? "B" + envelope.ciphertext.slice(1)
      : "A" + envelope.ciphertext.slice(1);
    await expect(open(keys, aad, { ...envelope, ciphertext: flipped })).rejects.toMatchObject({
      code: "secret_unavailable",
    });
    await expect(open(keys, aad, { ...envelope, wrappedDek: flipped })).rejects.toMatchObject({
      code: "secret_unavailable",
    });
  });

  it("rotates: the previous key still opens old envelopes, new envelopes use the current key", async () => {
    const previousOnly = await loadMasterKeys({ CONNECTIONS_MASTER_KEY: E.CONNECTIONS_MASTER_KEY_PREVIOUS });
    const old = await seal(previousOnly, aad, "old-secret-value");
    const both = await loadMasterKeys(E);
    expect(await open(both, aad, old)).toBe("old-secret-value");
    expect((await seal(both, aad, "new-secret-value")).keyVersion).toBe(both.current.version);
    const currentOnly = await loadMasterKeys({ CONNECTIONS_MASTER_KEY: E.CONNECTIONS_MASTER_KEY });
    await expect(open(currentOnly, aad, old)).rejects.toMatchObject({ code: "secret_unavailable" });
  });

  it("refuses a malformed master key", async () => {
    await expect(loadMasterKeys({ CONNECTIONS_MASTER_KEY: btoa("too-short") })).rejects.toThrow(/32 bytes/);
    await expect(loadMasterKeys({})).rejects.toThrow(/not configured/);
  });

  it("hints only values long enough to stay secret", () => {
    expect(hintFor("short")).toBe("");
    expect(hintFor("12345678")).toBe("5678");
  });

  it("compares digests safely", async () => {
    const a = await sha256Hex("x");
    expect(timingSafeEqual(a, a)).toBe(true);
    expect(timingSafeEqual(a, await sha256Hex("y"))).toBe(false);
    expect(timingSafeEqual("a", "ab")).toBe(false);
  });
});
