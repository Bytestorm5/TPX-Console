import { beforeEach, describe, expect, it } from "vitest";
import { catalog, isTpxError } from "@tpx/identity";
import type { Ctx, TenantCtx } from "@tpx/contracts/scope";
import { ConnectionsService, __setFetchForTests, __setStoreForTests, memoryStore } from "../../src/index.ts";
import type { MemoryStore } from "../../src/store/memory-store.ts";
import { TEST_ENV } from "./env.ts";

const ALL = catalog.ownedKeys.filter((k) => k.startsWith("tpx.connections."));
const READS = ALL.filter((k) => k.endsWith(".read"));

const base: Ctx = {
  tenantId: "org_a",
  projectId: "prj_a1",
  environmentId: "env_a1_prod",
  environmentName: "prod",
  userId: "ada",
  grants: ALL,
};
const ctxA = (over: Partial<Ctx> = {}): Ctx => ({ ...base, ...over });
const ctxADev = ctxA({ environmentId: "env_a1_dev", environmentName: "dev" });
const ctxB: Ctx = {
  tenantId: "org_b",
  projectId: "prj_b1",
  environmentId: "env_b1_prod",
  environmentName: "prod",
  userId: "bea",
  grants: ALL,
};
const viewer = ctxA({ userId: "vic", grants: READS });
const without = (key: string): Ctx => ctxA({ grants: ALL.filter((k) => k !== key) });

let store: MemoryStore;
let service: ConnectionsService;
let fetchCalls: { url: string; headers: Headers }[];
let fetchStatus = 200;

beforeEach(() => {
  store = memoryStore();
  fetchCalls = [];
  fetchStatus = 200;
  __setStoreForTests(store);
  __setFetchForTests(async (input, init) => {
    fetchCalls.push({ url: String(input), headers: new Headers(init?.headers) });
    return new Response("{}", { status: fetchStatus });
  });
  service = new ConnectionsService(TEST_ENV);
});

async function status(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    return isTpxError(e) ? e.status : -1;
  }
}

const TOKEN = "cf_token_ABCDEFGH1234";

async function cloudflareConnection(ctx: TenantCtx = base) {
  return service.createConnection(ctx, {
    provider: "cloudflare",
    name: "Cloudflare (prod account)",
    config: { account_id: "acct-1", zone_id: "zone-base" },
    credential: { api_token: TOKEN },
  });
}

describe("connections", () => {
  it("stores only ciphertext and returns redacted views", async () => {
    const connection = await cloudflareConnection();
    expect(connection.credential.api_token).toMatchObject({ set: true, hint: "1234" });
    expect(JSON.stringify(connection)).not.toContain(TOKEN);
    const rawRows = JSON.stringify([...store.rows.secrets.values()]);
    expect(rawRows).not.toContain(TOKEN);
    expect(rawRows).not.toContain("ABCDEFGH");
    expect([...store.rows.secrets.values()][0]?.hint).toBe("1234");

    expect((await service.listConnections(base)).map((c) => c.id)).toEqual([connection.id]);
    expect(await service.listConnections(ctxB)).toEqual([]);
    expect(await status(service.getConnection(ctxB, connection.id))).toBe(404);
  });

  it("validates providers, capabilities and field keys", async () => {
    expect(await status(service.createConnection(base, { provider: "nope", name: "x" }))).toBe(400);
    expect(await status(service.createConnection(base, { provider: "resend", name: "x", capabilities: ["dns"] }))).toBe(
      400,
    );
    expect(
      await status(service.createConnection(base, { provider: "cloudflare", name: "x", config: { bogus: "1" } })),
    ).toBe(400);
    expect(
      await status(service.createConnection(base, { provider: "cloudflare", name: "x", credential: { bogus: "1" } })),
    ).toBe(400);
    expect(await status(service.createConnection(base, { provider: "cloudflare", name: "" }))).toBe(400);
  });

  it("enforces grants on every surface", async () => {
    const connection = await cloudflareConnection();
    expect(await status(service.createConnection(viewer, { provider: "cloudflare", name: "x" }))).toBe(403);
    expect(
      await status(
        service.setConnectionCredential(viewer, connection.id, { environmentName: null, values: { api_token: "x" } }),
      ),
    ).toBe(403);
    expect(await status(service.deleteConnection(viewer, connection.id))).toBe(403);
    expect(
      await status(
        service.revealSecret(viewer, { level: "connection-base", connectionId: connection.id }, "api_token"),
      ),
    ).toBe(403);
    expect(await status(service.attachConnection(viewer, { connectionId: connection.id, capability: "dns" }))).toBe(
      403,
    );
    expect(await status(service.listConnections(without("tpx.connections.connections.read")))).toBe(403);
    expect(await status(service.listAudit(without("tpx.connections.audit.read")))).toBe(403);
    expect((await service.listConnections(viewer)).length).toBe(1);
    // A malformed context is a programming error, never a denial.
    expect(await status(service.listConnections({ tenantId: "org_a" } as never))).toBe(400);
  });

  it("reveals one secret at a time, only with the reveal grant, and audits it", async () => {
    const connection = await cloudflareConnection();
    const revealed = await service.revealSecret(
      base,
      { level: "connection-base", connectionId: connection.id },
      "api_token",
    );
    expect(revealed).toEqual({ key: "api_token", value: TOKEN, suppliedBy: "connection-base" });
    expect(
      await status(service.revealSecret(base, { level: "connection-base", connectionId: connection.id }, "nope")),
    ).toBe(404);
    expect(
      await status(service.revealSecret(ctxB, { level: "connection-base", connectionId: connection.id }, "api_token")),
    ).toBe(404);
    const audit = await service.listAudit(base);
    const reveal = audit.find((a) => a.action === "secret.reveal");
    expect(reveal).toMatchObject({
      userId: "ada",
      level: "connection-base",
      target: connection.id,
      detail: { key: "api_token" },
    });
  });

  it("keeps per-environment defaults keyed by name and rotates or clears credentials", async () => {
    const connection = await cloudflareConnection();
    const withDev = await service.setConnectionCredential(base, connection.id, {
      environmentName: "dev",
      values: { api_token: "cf_dev_token_XYZ98765" },
      config: { zone_id: "zone-dev" },
    });
    expect(withDev.environmentDefaults.dev).toMatchObject({
      config: { zone_id: "zone-dev" },
      credential: { api_token: { set: true, hint: "8765" } },
    });
    expect(withDev.credential.api_token?.hint).toBe("1234");
    const cleared = await service.setConnectionCredential(base, connection.id, {
      environmentName: null,
      values: { api_token: "" },
    });
    expect(cleared.credential).toEqual({});
    expect(cleared.environmentDefaults.dev?.credential.api_token?.set).toBe(true);
    const audit = await service.listAudit(base);
    expect(
      audit
        .filter((a) => a.action === "credential.rotate")
        .map((a) => a.level)
        .sort(),
    ).toEqual(["connection-base", "connection-environment"]);
  });

  it("runs a live test with the resolved credential and records the outcome", async () => {
    const connection = await cloudflareConnection();
    const ok = await service.testConnection(base, connection.id, null);
    expect(ok.ok).toBe(true);
    expect(fetchCalls[0]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect((await service.getConnection(base, connection.id)).lastTest).toMatchObject({ ok: true });
    fetchStatus = 401;
    const failed = await service.testConnection(base, connection.id, null);
    expect(failed).toMatchObject({ ok: false, message: expect.stringContaining("401") });
    const s3 = await service.createConnection(base, { provider: "aws-s3", name: "Bucket" });
    expect((await service.testConnection(base, s3.id, null)).ok).toBe(false);
    expect((await service.listAudit(base)).filter((a) => a.action === "connection.test")).toHaveLength(3);
  });
});

describe("attachments, bindings and resolution", () => {
  it("attaches with a default per capability and names, and stays inside the tenant and project", async () => {
    const connection = await cloudflareConnection();
    const first = await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    expect(first).toMatchObject({ name: "cloudflare-prod-account", isDefault: true, projectId: "prj_a1" });
    expect(await status(service.attachConnection(base, { connectionId: connection.id, capability: "dns" }))).toBe(409);
    const second = await service.attachConnection(base, {
      connectionId: connection.id,
      capability: "dns",
      name: "edge-eu",
    });
    expect(second.isDefault).toBe(false);
    const promoted = await service.updateAttachment(base, second.id, { isDefault: true });
    expect(promoted.isDefault).toBe(true);
    expect((await service.listAttachments(base)).map((a) => [a.name, a.isDefault])).toEqual([
      ["cloudflare-prod-account", false],
      ["edge-eu", true],
    ]);
    expect(await status(service.attachConnection(base, { connectionId: connection.id, capability: "storage" }))).toBe(
      400,
    );
    expect(await status(service.attachConnection(ctxB, { connectionId: connection.id, capability: "dns" }))).toBe(404);
    expect(await service.listAttachments(ctxB)).toEqual([]);
    expect(await status(service.getBinding(ctxA({ projectId: "prj_a2" }), first.id))).toBe(404);
  });

  it("resolves innermost-first and shows which level supplied each field", async () => {
    const connection = await cloudflareConnection();
    const attachment = await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    const byKey = async (ctx: Ctx) =>
      Object.fromEntries((await service.resolve(ctx, "dns")).fields.map((f) => [f.key, f]));

    let fields = await byKey(base);
    expect(fields.zone_id).toMatchObject({ value: "zone-base", suppliedBy: "connection-base" });
    expect(fields.api_token).toMatchObject({ set: true, suppliedBy: "connection-base" });
    expect(fields.api_token?.value).toBeUndefined();

    await service.setConnectionCredential(base, connection.id, {
      environmentName: "prod",
      values: {},
      config: { zone_id: "zone-prod" },
    });
    fields = await byKey(base);
    expect(fields.zone_id).toMatchObject({ value: "zone-prod", suppliedBy: "connection-environment" });
    expect(fields.api_token).toMatchObject({ suppliedBy: "connection-base" });
    expect((await byKey(ctxADev)).zone_id).toMatchObject({ value: "zone-base", suppliedBy: "connection-base" });

    await service.updateAttachment(base, attachment.id, { config: { zone_id: "zone-att" } });
    expect((await byKey(base)).zone_id).toMatchObject({ value: "zone-att", suppliedBy: "attachment" });

    const binding = await service.setBinding(base, attachment.id, {
      config: { zone_id: "zone-bind" },
      credential: { api_token: "cf_bind_token_QRST4321" },
    });
    expect(binding.credential.api_token).toMatchObject({ set: true, hint: "4321" });
    fields = await byKey(base);
    expect(fields.zone_id).toMatchObject({ value: "zone-bind", suppliedBy: "binding" });
    expect(fields.api_token).toMatchObject({ suppliedBy: "binding", hint: "4321" });
    expect((await byKey(ctxADev)).api_token).toMatchObject({ suppliedBy: "connection-base" });

    await service.clearBinding(base, attachment.id);
    expect(await service.getBinding(base, attachment.id)).toBeNull();
    expect((await byKey(base)).zone_id).toMatchObject({ value: "zone-att", suppliedBy: "attachment" });

    const resolution = await service.resolve(base, "dns");
    expect(resolution.available).toBe(true);
    expect(resolution.attachment).toMatchObject({ id: attachment.id, provider: "cloudflare" });
    expect(await service.resolve(base, "email")).toMatchObject({ available: false, attachment: null });
    expect(await service.resolve(base, "dns", "nope")).toMatchObject({ available: false, attachment: null });
  });

  it("says a capability is unavailable up front when nothing supplies a required value", async () => {
    const connection = await service.createConnection(base, { provider: "cloudflare", name: "Empty" });
    await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    const resolution = await service.resolve(base, "dns");
    expect(resolution.available).toBe(false);
    expect(resolution.missing).toEqual(["account_id", "api_token"]);
    expect(await service.execute(base, "dns", null, "test", {})).toMatchObject({
      ok: false,
      error: expect.stringContaining("unavailable"),
    });
  });

  it("executes with the innermost credential and never returns it", async () => {
    const connection = await cloudflareConnection();
    const attachment = await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    await service.setBinding(base, attachment.id, { credential: { api_token: "cf_bind_token_QRST4321" } });
    const result = await service.execute(base, "dns", null, "test", {});
    expect(result).toMatchObject({ ok: true, suppliedBy: "binding" });
    expect(JSON.stringify(result)).not.toContain("QRST4321");
    expect(fetchCalls[0]?.headers.get("authorization")).toBe("Bearer cf_bind_token_QRST4321");
    expect(await service.execute(base, "dns", null, "purge_everything", {})).toMatchObject({
      ok: false,
      error: expect.stringContaining("does not implement"),
    });
    expect(
      await status(service.execute(without("tpx.connections.usage.execute_capability"), "dns", null, "test", {})),
    ).toBe(403);
    const audit = await service.listAudit(base, { projectId: "prj_a1" });
    expect(audit.filter((a) => a.action === "capability.execute").map((a) => a.level)).toEqual(["binding", "binding"]);
  });

  it("promotes between environments only as a diffed, confirmed action", async () => {
    const connection = await cloudflareConnection();
    const attachment = await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    await service.setBinding(ctxADev, attachment.id, {
      config: { zone_id: "zone-dev" },
      credential: { api_token: "cf_dev_token_XYZ98765" },
    });
    await service.setBinding(base, attachment.id, {
      config: { zone_id: "zone-old-prod", account_id: "acct-prod-only" },
    });

    const plan = await service.planPromotion(ctxADev, attachment.id, "env_a1_prod");
    expect(plan.changes).toEqual([
      {
        key: "account_id",
        secret: false,
        from: { set: false },
        to: { set: true, value: "acct-prod-only" },
        action: "clear",
      },
      {
        key: "api_token",
        secret: true,
        from: { set: true, hint: "8765", updatedAt: expect.any(Number) },
        to: { set: false },
        action: "copy",
      },
      {
        key: "zone_id",
        secret: false,
        from: { set: true, value: "zone-dev" },
        to: { set: true, value: "zone-old-prod" },
        action: "copy",
      },
    ]);
    expect(
      await status(
        service.promote(ctxADev, {
          attachmentId: attachment.id,
          toEnvironmentId: "env_a1_prod",
          digest: "0".repeat(64),
        }),
      ),
    ).toBe(409);
    expect(await status(service.planPromotion(ctxADev, attachment.id, "env_a1_dev"))).toBe(400);

    const promoted = await service.promote(ctxADev, {
      attachmentId: attachment.id,
      toEnvironmentId: "env_a1_prod",
      digest: plan.digest,
    });
    expect(promoted.config).toEqual({ zone_id: "zone-dev" });
    expect(promoted.credential.api_token).toMatchObject({ set: true, hint: "8765" });
    const revealed = await service.revealSecret(
      base,
      { level: "binding", attachmentId: attachment.id, environmentId: "env_a1_prod" },
      "api_token",
    );
    expect(revealed.value).toBe("cf_dev_token_XYZ98765");

    // The source changed after the plan was reviewed: the old digest no longer applies.
    await service.setBinding(ctxADev, attachment.id, { config: { zone_id: "zone-dev-2" } });
    expect(
      await status(
        service.promote(ctxADev, { attachmentId: attachment.id, toEnvironmentId: "env_a1_prod", digest: plan.digest }),
      ),
    ).toBe(409);
    expect((await service.listAudit(base)).some((a) => a.action === "binding.promote" && a.level === "binding")).toBe(
      true,
    );
  });

  it("deleting a connection cascades to attachments, bindings and every secret", async () => {
    const connection = await cloudflareConnection();
    const attachment = await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });
    await service.setBinding(base, attachment.id, { credential: { api_token: "cf_bind_token_QRST4321" } });
    await service.setConnectionCredential(base, connection.id, {
      environmentName: "dev",
      values: { api_token: "cf_dev_token_XYZ98765" },
    });
    expect(store.rows.secrets.size).toBe(3);
    await service.deleteConnection(base, connection.id);
    expect(store.rows.secrets.size).toBe(0);
    expect(store.rows.attachments.size).toBe(0);
    expect(store.rows.bindings.size).toBe(0);
    expect(await service.listConnections(base)).toEqual([]);
    expect(await status(service.deleteConnection(base, connection.id))).toBe(404);
  });

  it("scopes the audit log by tenant and project", async () => {
    const a = await cloudflareConnection();
    await service.attachConnection(base, { connectionId: a.id, capability: "dns" });
    await service.attachConnection(ctxA({ projectId: "prj_a2", environmentId: "env_a2_prod" }), {
      connectionId: a.id,
      capability: "cdn",
    });
    await cloudflareConnection(ctxB);
    expect((await service.listAudit(base)).every((e) => e.tenantId === "org_a")).toBe(true);
    expect((await service.listAudit(base, { projectId: "prj_a1" })).map((e) => e.action)).toEqual([
      "attachment.create",
    ]);
    expect((await service.listAudit(ctxB)).map((e) => e.action)).toEqual(["connection.create"]);
  });
});

describe("json surface (behind the shell's /api/connections forwarder)", () => {
  it("knows only its own routes", async () => {
    expect((await service.handle(base, new Request("https://connections.internal/nothing"))).status).toBe(404);
    expect(
      (await service.handle(base, new Request("https://connections.internal/providers", { method: "POST" }))).status,
    ).toBe(404);
  });

  it("serves providers and resolution through the same grant checks as the direct methods", async () => {
    const connection = await cloudflareConnection();
    await service.attachConnection(base, { connectionId: connection.id, capability: "dns" });

    const providers = await service.handle(base, new Request("https://connections.internal/providers"));
    expect(providers.status).toBe(200);
    expect(((await providers.json()) as { id: string }[]).map((p) => p.id)).toContain("cloudflare");

    const resolved = await service.handle(base, new Request("https://connections.internal/resolve/dns"));
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as {
      available: boolean;
      fields: { key: string; value?: string; suppliedBy: string | null }[];
    };
    expect(body.available).toBe(true);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(body.fields.find((f) => f.key === "zone_id")).toMatchObject({
      value: "zone-base",
      suppliedBy: "connection-base",
    });

    const forbidden = await service.handle(
      without("tpx.connections.usage.read"),
      new Request("https://connections.internal/resolve/dns"),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "forbidden" });

    const badBody = await service.handle(
      base,
      new Request("https://connections.internal/execute/dns", { method: "POST", body: "nope" }),
    );
    expect(badBody.status).toBe(400);
  });
});
