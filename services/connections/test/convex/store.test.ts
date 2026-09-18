import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { ConvexCaller } from "@tpx/convex-client";
import schema from "@tpx/convex/schema";
import { modules } from "@tpx/convex/test-modules";
import { convexStore } from "../../src/store/convex-store";
import type { AttachmentRow, ConnectionRow, SecretRow } from "../../src/store/types";

function freshStore() {
  const t = convexTest(schema, modules);
  const call = (fn: (...a: never[]) => Promise<unknown>) => (ref: unknown, args: unknown) =>
    fn(ref as never, args as never);
  const caller: ConvexCaller = {
    query: call(t.query as never) as ConvexCaller["query"],
    mutation: call(t.mutation as never) as ConvexCaller["mutation"],
  };
  return convexStore(caller);
}

const connection = (id: string, tenantId: string): ConnectionRow => ({
  id,
  tenantId,
  provider: "cloudflare",
  name: "CF",
  capabilities: ["dns"],
  config: { account_id: "a" },
  createdBy: "u",
  createdAt: 1,
  updatedAt: 1,
  lastTest: null,
});
const attachment = (
  id: string,
  tenantId: string,
  projectId: string,
  connectionId: string,
  name = "cf",
): AttachmentRow => ({
  id,
  tenantId,
  projectId,
  connectionId,
  name,
  capability: "dns",
  isDefault: true,
  config: {},
  createdAt: 1,
  updatedAt: 1,
});
const secret = (
  id: string,
  tenantId: string,
  ownerKind: SecretRow["ownerKind"],
  ownerId: string,
  environmentKey: string,
  key: string,
): SecretRow => ({
  id,
  tenantId,
  ownerKind,
  ownerId,
  environmentKey,
  key,
  ciphertext: "c",
  iv: "i",
  wrappedDek: "w",
  dekIv: "d",
  keyVersion: "v1",
  hint: "1234",
  createdAt: 1,
  updatedAt: 1,
});

describe("convex store — connections", () => {
  it("keeps tenants apart and cascades deletes", async () => {
    const store = freshStore();
    await store.insertConnection(connection("con_a", "org_a"));
    await store.insertConnection(connection("con_b", "org_b"));
    expect((await store.listConnections("org_a")).map((c) => c.id)).toEqual(["con_a"]);
    expect(await store.getConnection("org_b", "con_a")).toBeNull();
    await expect(store.insertConnection(connection("con_a", "org_a"))).rejects.toThrow(/already exists/);

    await store.upsertEnvironmentDefault({
      connectionId: "con_a",
      tenantId: "org_a",
      environmentName: "dev",
      config: { zone_id: "z" },
    });
    await store.upsertSecret(secret("s1", "org_a", "connection-base", "con_a", "", "api_token"));
    await store.upsertSecret(secret("s2", "org_a", "connection-environment", "con_a", "dev", "api_token"));
    expect(await store.insertAttachment(attachment("att_1", "org_a", "prj_1", "con_a"))).toBe(true);
    expect(await store.insertAttachment(attachment("att_2", "org_a", "prj_1", "con_a"))).toBe(false);
    expect(await store.insertAttachment(attachment("att_3", "org_a", "prj_1", "con_a", "other"))).toBe(true);
    await store.upsertBinding({
      attachmentId: "att_1",
      environmentId: "env_1",
      tenantId: "org_a",
      projectId: "prj_1",
      config: { zone_id: "b" },
      updatedAt: 2,
    });
    await store.upsertSecret(secret("s3", "org_a", "binding", "att_1", "env_1", "api_token"));
    await store.upsertSecret(secret("s4", "org_a", "attachment", "att_3", "", "api_token"));

    expect(
      (await store.listSecrets("org_a", [{ ownerKind: "connection-base", ownerId: "con_a", environmentKey: "" }])).map(
        (s) => s.id,
      ),
    ).toEqual(["s1"]);
    expect(
      await store.listSecrets("org_b", [{ ownerKind: "connection-base", ownerId: "con_a", environmentKey: "" }]),
    ).toEqual([]);
    await store.upsertSecret({ ...secret("s1b", "org_a", "connection-base", "con_a", "", "api_token"), updatedAt: 9 });
    const rotated = await store.listSecrets("org_a", [
      { ownerKind: "connection-base", ownerId: "con_a", environmentKey: "" },
    ]);
    expect(rotated).toHaveLength(1);
    expect(rotated[0]).toMatchObject({ id: "s1b", createdAt: 1, updatedAt: 9 });

    await store.setDefaultAttachment("org_a", "prj_1", "dns", "att_3");
    expect((await store.listAttachments("org_a", "prj_1")).map((a) => [a.id, a.isDefault])).toEqual([
      ["att_1", false],
      ["att_3", true],
    ]);
    expect((await store.getBinding("org_a", "att_1", "env_1"))?.config).toEqual({ zone_id: "b" });
    expect(await store.getBinding("org_b", "att_1", "env_1")).toBeNull();

    await store.deleteAttachment("org_a", "att_3");
    expect(
      await store.listSecrets("org_a", [{ ownerKind: "attachment", ownerId: "att_3", environmentKey: "" }]),
    ).toEqual([]);

    await store.deleteConnection("org_b", "con_a"); // wrong tenant: no-op
    expect(await store.getConnection("org_a", "con_a")).not.toBeNull();
    await store.deleteConnection("org_a", "con_a");
    expect(await store.getConnection("org_a", "con_a")).toBeNull();
    expect(await store.listAttachments("org_a", "prj_1")).toEqual([]);
    expect(await store.listBindings("org_a", "att_1")).toEqual([]);
    expect(await store.listEnvironmentDefaults("org_a", "con_a")).toEqual([]);
    for (const owner of [
      { ownerKind: "connection-base" as const, ownerId: "con_a", environmentKey: "" },
      { ownerKind: "connection-environment" as const, ownerId: "con_a", environmentKey: "dev" },
      { ownerKind: "binding" as const, ownerId: "att_1", environmentKey: "env_1" },
    ]) {
      expect(await store.listSecrets("org_a", [owner])).toEqual([]);
    }
    expect((await store.listConnections("org_b")).map((c) => c.id)).toEqual(["con_b"]);
  });

  it("orders audit newest first and filters by project", async () => {
    const store = freshStore();
    const row = (id: string, at: number, projectId: string | null) => ({
      id,
      tenantId: "org_a",
      projectId,
      environmentId: null,
      userId: "u",
      action: "x",
      target: "t",
      level: null,
      at,
    });
    await store.recordAudit(row("a1", 1, "prj_1"));
    await store.recordAudit({ ...row("a2", 2, "prj_2"), detail: { n: 1 } });
    await store.recordAudit(row("a3", 3, null));
    expect((await store.listAudit("org_a", { limit: 10 })).map((a) => a.id)).toEqual(["a3", "a2", "a1"]);
    expect((await store.listAudit("org_a", { limit: 10, projectId: "prj_2" })).map((a) => a.id)).toEqual(["a2"]);
    expect(await store.listAudit("org_b", { limit: 10 })).toEqual([]);
  });
});
