/**
 * The connections service — the surface the console calls in-process. The
 * Worker entry constructs one `ConnectionsService` with the Worker's env;
 * loaders, actions and the `/api/connections/*` forwarder call its methods
 * directly. Tenant-level objects take a TenantCtx, project- and
 * environment-shaped ones the full Ctx; every method enforces the grant the
 * catalog names for it and scopes every read by tenant.
 *
 * Secrets: plaintext exists only inside a request that creates, rotates,
 * tests, executes with, promotes, or explicitly reveals a credential. Every
 * read surface returns hints. Reveals are separately permissioned and always
 * audited with the level that supplied the value.
 */
import { z } from "zod";
import {
  AttachConnectionInputSchema,
  CapabilitySchema,
  CreateConnectionInputSchema,
  SecretLocatorSchema,
  SetBindingInputSchema,
  SetConnectionCredentialInputSchema,
  UpdateAttachmentInputSchema,
  UpdateConnectionInputSchema,
  type Attachment,
  type Binding,
  type Capability,
  type Connection,
  type ConnectionsAuditEntry,
  type ConnectionsServiceContract,
  type ExecuteResult,
  type Hints,
  type PromotionPlan,
  type ProviderDescriptor,
  type ResolutionLevel,
  type Resolution,
  type RevealedSecret,
  type SecretLocator,
  type TestResult,
} from "@tpx/contracts/connections";
import type { ProductCapabilities } from "@tpx/contracts/product";
import {
  CtxSchema,
  EnvironmentNameSchema as ConnectionEnvironmentNameSchema,
  IdSchema,
  TenantCtxSchema,
  type Ctx,
  type TenantCtx,
} from "@tpx/contracts/scope";
import { createConvexCaller } from "@tpx/convex-client";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TpxError,
  ValidationError,
  requireGrant,
  type TpxKey,
} from "@tpx/identity";
import { aadFor, loadMasterKeys, open, seal, sha256Hex, timingSafeEqual, type MasterKeys } from "./crypto.ts";
import { newId, slugify } from "./ids.ts";
import { getProvider, listProviders } from "./providers/index.ts";
import type { ProviderImpl } from "./providers/types.ts";
import {
  LEVEL_ORDER,
  missingRequired,
  pickInnermost,
  resolveFields,
  type LevelValues,
  type ResolutionLevels,
} from "./resolve.ts";
import { convexStore } from "./store/convex-store.ts";
import { memoryStore } from "./store/memory-store.ts";
import type { AttachmentRow, BindingRow, ConnectionRow, ConnectionsStore, OwnerRef, SecretRow } from "./store/types.ts";

/** The slice of the Worker's env the connections service reads. */
export interface ConnectionsEnv {
  CONVEX_URL: string;
  CONVEX_DEPLOY_KEY: string;
  CONNECTIONS_MASTER_KEY: string;
  CONNECTIONS_MASTER_KEY_PREVIOUS?: string;
  /** `memory` runs the service against an in-memory store — local development only. */
  TPX_STORE?: string;
}

const AUDIT_LIMIT_DEFAULT = 100;
const AUDIT_LIMIT_MAX = 500;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

const ownerBase = (connectionId: string): OwnerRef => ({
  ownerKind: "connection-base",
  ownerId: connectionId,
  environmentKey: "",
});
const ownerEnvironment = (connectionId: string, environmentName: string): OwnerRef => ({
  ownerKind: "connection-environment",
  ownerId: connectionId,
  environmentKey: environmentName,
});
const ownerAttachment = (attachmentId: string): OwnerRef => ({
  ownerKind: "attachment",
  ownerId: attachmentId,
  environmentKey: "",
});
const ownerBinding = (attachmentId: string, environmentId: string): OwnerRef => ({
  ownerKind: "binding",
  ownerId: attachmentId,
  environmentKey: environmentId,
});

const sameOwner = (a: OwnerRef, b: OwnerRef) =>
  a.ownerKind === b.ownerKind && a.ownerId === b.ownerId && a.environmentKey === b.environmentKey;

function hintsOf(rows: readonly SecretRow[]): Hints {
  const hints: Hints = {};
  for (const row of rows)
    hints[row.key] = { set: true, ...(row.hint ? { hint: row.hint } : {}), updatedAt: row.updatedAt };
  return hints;
}

function levelOf(config: Record<string, string>, rows: readonly SecretRow[]): LevelValues {
  return { config, secrets: new Map(rows.map((r) => [r.key, { hint: r.hint, updatedAt: r.updatedAt }])) };
}

// -- runtime ------------------------------------------------------------------
interface Runtime {
  store: ConnectionsStore;
  keys: Promise<MasterKeys>;
  fetch: typeof globalThis.fetch;
}

const runtimes = new Map<string, Runtime>();
let storeOverride: ConnectionsStore | null = null;
let fetchOverride: typeof globalThis.fetch | null = null;

/** Tests swap the store and outbound fetch; production never calls these. */
export function __setStoreForTests(store: ConnectionsStore | null): void {
  storeOverride = store;
  runtimes.clear();
}
export function __setFetchForTests(fetchImpl: typeof globalThis.fetch | null): void {
  fetchOverride = fetchImpl;
  runtimes.clear();
}

let devMemoryStore: ConnectionsStore | null = null;

function resolveRuntime(env: ConnectionsEnv): Runtime {
  const memory = env.TPX_STORE === "memory";
  const key = storeOverride ? "test" : memory ? "memory" : `${env.CONVEX_URL}|${env.CONVEX_DEPLOY_KEY}`;
  const existing = runtimes.get(key);
  if (existing) return existing;
  if (!storeOverride && !memory && (!env.CONVEX_URL || !env.CONVEX_DEPLOY_KEY)) {
    throw new Error("connections service: CONVEX_URL and CONVEX_DEPLOY_KEY must be configured");
  }
  const store =
    storeOverride ??
    (memory
      ? (devMemoryStore ??= memoryStore())
      : convexStore(createConvexCaller({ url: env.CONVEX_URL, deployKey: env.CONVEX_DEPLOY_KEY })));
  const runtime: Runtime = {
    store,
    keys: loadMasterKeys(env),
    fetch: fetchOverride ?? globalThis.fetch.bind(globalThis),
  };
  runtime.keys.catch(() => runtimes.delete(key));
  runtimes.set(key, runtime);
  return runtime;
}

export class ConnectionsService implements ConnectionsServiceContract {
  readonly #env: ConnectionsEnv;

  constructor(env: ConnectionsEnv) {
    this.#env = env;
  }

  #rt(): Runtime {
    return resolveRuntime(this.#env);
  }

  #tenantCtx(ctx: unknown, key: TpxKey): TenantCtx {
    const parsed = parse(TenantCtxSchema, ctx);
    requireGrant(parsed, key);
    return parsed;
  }

  #scopedCtx(ctx: unknown, key: TpxKey): Ctx {
    const parsed = parse(CtxSchema, ctx);
    requireGrant(parsed, key);
    return parsed;
  }

  async #audit(
    rt: Runtime,
    ctx: TenantCtx & Partial<Pick<Ctx, "projectId" | "environmentId">>,
    action: string,
    target: string,
    level: ResolutionLevel | null,
    detail?: unknown,
  ): Promise<void> {
    await rt.store.recordAudit({
      id: newId("aud"),
      tenantId: ctx.tenantId,
      projectId: ctx.projectId ?? null,
      environmentId: ctx.environmentId ?? null,
      userId: ctx.userId,
      action,
      target,
      level,
      at: Date.now(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  async #connection(
    rt: Runtime,
    tenantId: string,
    connectionId: string,
  ): Promise<{ row: ConnectionRow; provider: ProviderImpl }> {
    const row = await rt.store.getConnection(tenantId, parse(IdSchema, connectionId));
    if (!row) throw new NotFoundError("connection not found");
    const provider = getProvider(row.provider);
    if (!provider) throw new NotFoundError(`provider ${row.provider} is no longer registered`);
    return { row, provider };
  }

  async #attachment(rt: Runtime, ctx: Ctx, attachmentId: string): Promise<AttachmentRow> {
    const row = await rt.store.getAttachment(ctx.tenantId, parse(IdSchema, attachmentId));
    if (!row || row.projectId !== ctx.projectId) throw new NotFoundError("attachment not found in this project");
    return row;
  }

  /** Validates keys against the provider and writes ciphertext; an empty string clears a key. */
  async #writeSecrets(
    rt: Runtime,
    tenantId: string,
    provider: ProviderImpl,
    owner: OwnerRef,
    values: Record<string, string>,
  ): Promise<{ set: string[]; cleared: string[] }> {
    const known = new Set(provider.descriptor.credentialFields.filter((f) => f.secret).map((f) => f.key));
    const set: string[] = [];
    const cleared: string[] = [];
    const keys = await rt.keys;
    for (const [key, value] of Object.entries(values)) {
      if (!known.has(key))
        throw new ValidationError(
          `${JSON.stringify(key)} is not a secret credential field of ${provider.descriptor.id}`,
        );
      if (value === "") {
        await rt.store.deleteSecret(tenantId, owner, key);
        cleared.push(key);
        continue;
      }
      const envelope = await seal(keys, aadFor({ tenantId, ...owner, key }), value);
      const now = Date.now();
      await rt.store.upsertSecret({
        id: newId("sec"),
        tenantId,
        ...owner,
        key,
        ...envelope,
        createdAt: now,
        updatedAt: now,
      });
      set.push(key);
    }
    return { set, cleared };
  }

  #validateConfig(provider: ProviderImpl, config: Record<string, string>): Record<string, string> {
    const known = new Set([
      ...provider.descriptor.configFields.map((f) => f.key),
      ...provider.descriptor.credentialFields.filter((f) => !f.secret).map((f) => f.key),
    ]);
    for (const key of Object.keys(config)) {
      if (!known.has(key))
        throw new ValidationError(`${JSON.stringify(key)} is not a config field of ${provider.descriptor.id}`);
    }
    return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ""));
  }

  async #connectionView(rt: Runtime, row: ConnectionRow): Promise<Connection> {
    const defaults = await rt.store.listEnvironmentDefaults(row.tenantId, row.id);
    const baseSecrets = await rt.store.listSecrets(row.tenantId, [ownerBase(row.id)]);
    const envNames = new Set(defaults.map((d) => d.environmentName));
    // Environment defaults may exist as secrets alone, with no config row.
    const allEnvSecrets = await rt.store.listSecrets(
      row.tenantId,
      [...envNames].map((n) => ownerEnvironment(row.id, n)),
    );
    const environmentDefaults: Connection["environmentDefaults"] = {};
    for (const name of envNames) {
      environmentDefaults[name] = {
        config: defaults.find((d) => d.environmentName === name)?.config ?? {},
        credential: hintsOf(allEnvSecrets.filter((s) => s.environmentKey === name)),
      };
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      provider: row.provider,
      name: row.name,
      capabilities: row.capabilities as Capability[],
      config: row.config,
      credential: hintsOf(baseSecrets),
      environmentDefaults,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastTest: row.lastTest,
    };
  }

  async #attachmentView(rt: Runtime, row: AttachmentRow): Promise<Attachment> {
    const secrets = await rt.store.listSecrets(row.tenantId, [ownerAttachment(row.id)]);
    return {
      id: row.id,
      tenantId: row.tenantId,
      projectId: row.projectId,
      connectionId: row.connectionId,
      name: row.name,
      capability: row.capability as Capability,
      isDefault: row.isDefault,
      config: row.config,
      credential: hintsOf(secrets),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async #bindingView(rt: Runtime, row: BindingRow): Promise<Binding> {
    const secrets = await rt.store.listSecrets(row.tenantId, [ownerBinding(row.attachmentId, row.environmentId)]);
    return { ...row, credential: hintsOf(secrets) };
  }

  /** Every level's config and secret rows for an attachment in the request's environment. */
  async #gather(rt: Runtime, ctx: Ctx, attachment: AttachmentRow) {
    const { row: connection, provider } = await this.#connection(rt, ctx.tenantId, attachment.connectionId);
    const owners = {
      "connection-base": ownerBase(connection.id),
      "connection-environment": ownerEnvironment(connection.id, ctx.environmentName),
      attachment: ownerAttachment(attachment.id),
      binding: ownerBinding(attachment.id, ctx.environmentId),
    } as const satisfies Record<ResolutionLevel, OwnerRef>;
    const [secrets, defaults, binding] = await Promise.all([
      rt.store.listSecrets(ctx.tenantId, Object.values(owners)),
      rt.store.listEnvironmentDefaults(ctx.tenantId, connection.id),
      rt.store.getBinding(ctx.tenantId, attachment.id, ctx.environmentId),
    ]);
    const rowsAt = (level: ResolutionLevel) => secrets.filter((s) => sameOwner(s, owners[level]));
    const envDefault = defaults.find((d) => d.environmentName === ctx.environmentName);
    const envRows = rowsAt("connection-environment");
    const bindingRows = rowsAt("binding");
    const levels: ResolutionLevels = {
      base: levelOf(connection.config, rowsAt("connection-base")),
      environmentDefault: envDefault || envRows.length > 0 ? levelOf(envDefault?.config ?? {}, envRows) : null,
      attachment: levelOf(attachment.config, rowsAt("attachment")),
      binding: binding || bindingRows.length > 0 ? levelOf(binding?.config ?? {}, bindingRows) : null,
    };
    const secretRowsByLevel: Partial<Record<ResolutionLevel, SecretRow[]>> = {};
    for (const level of LEVEL_ORDER) secretRowsByLevel[level] = rowsAt(level);
    return { connection, provider, owners, levels, secretRowsByLevel };
  }

  async #findAttachment(
    rt: Runtime,
    ctx: Ctx,
    capability: Capability,
    attachmentName?: string,
  ): Promise<AttachmentRow | null> {
    const rows = (await rt.store.listAttachments(ctx.tenantId, ctx.projectId)).filter(
      (a) => a.capability === capability,
    );
    if (attachmentName !== undefined) return rows.find((a) => a.name === attachmentName) ?? null;
    return rows.find((a) => a.isDefault) ?? (rows.length === 1 ? (rows[0] ?? null) : null);
  }

  async #openSecrets(
    rt: Runtime,
    tenantId: string,
    chosen: Map<string, { row: SecretRow; level: ResolutionLevel }>,
  ): Promise<Record<string, string>> {
    const keys = await rt.keys;
    const out: Record<string, string> = {};
    for (const [key, { row }] of chosen) {
      out[key] = await open(
        keys,
        aadFor({ tenantId, ownerKind: row.ownerKind, ownerId: row.ownerId, environmentKey: row.environmentKey, key }),
        row,
      );
    }
    return out;
  }

  // -- the JSON surface & catalog -----------------------------------------------------
  /**
   * The HTTP surface behind the shell's `/api/connections/*` forwarder. The
   * forwarder has already resolved the caller's scope into `ctx`, and the
   * request URL is relative to the product root. Every handler here goes
   * through the same methods the loaders call, so the grant checks and the
   * audit trail are identical whichever way a call arrives.
   */
  async handle(ctx: Ctx, request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/providers") return Response.json(await this.listProviders());
      const resolveMatch = /^\/resolve\/([a-z]+)$/.exec(url.pathname);
      if (request.method === "GET" && resolveMatch) {
        const name = url.searchParams.get("name");
        return Response.json(await this.resolve(ctx, resolveMatch[1] as Capability, name ?? undefined));
      }
      const executeMatch = /^\/execute\/([a-z]+)$/.exec(url.pathname);
      if (request.method === "POST" && executeMatch) {
        const body = (await request.json().catch(() => null)) as {
          name?: string | null;
          op?: string;
          args?: unknown;
        } | null;
        if (!body || typeof body.op !== "string")
          return Response.json({ error: "body must be { op, name?, args? }" }, { status: 400 });
        return Response.json(
          await this.execute(ctx, executeMatch[1] as Capability, body.name ?? null, body.op, body.args),
        );
      }
      return Response.json({ error: "not found" }, { status: 404 });
    } catch (error) {
      if (error instanceof TpxError)
        return Response.json({ error: error.detail, code: error.code }, { status: error.status });
      throw error;
    }
  }

  async capabilities(): Promise<ProductCapabilities> {
    return {
      product: "connections",
      enabled: true,
      features: ["marketplace", "attachments", "bindings", "promotion", "audit"],
      version: "0.1.0",
    };
  }

  async listProviders(): Promise<ProviderDescriptor[]> {
    return listProviders();
  }

  // -- connections (tenant) ------------------------------------------------------------
  async listConnections(ctx: TenantCtx): Promise<Connection[]> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.read");
    const rt = this.#rt();
    const rows = await rt.store.listConnections(c.tenantId);
    return Promise.all(rows.map((row) => this.#connectionView(rt, row)));
  }

  async getConnection(ctx: TenantCtx, connectionId: string): Promise<Connection> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.read");
    const rt = this.#rt();
    const { row } = await this.#connection(rt, c.tenantId, connectionId);
    return this.#connectionView(rt, row);
  }

  async createConnection(ctx: TenantCtx, input: unknown): Promise<Connection> {
    const c = this.#tenantCtx(ctx, "tpx.connections.marketplace.create_connection");
    const parsed = parse(CreateConnectionInputSchema, input);
    const provider = getProvider(parsed.provider);
    if (!provider) throw new ValidationError(`unknown provider ${JSON.stringify(parsed.provider)}`);
    const capabilities = parsed.capabilities ?? provider.descriptor.capabilities;
    const unsupported = capabilities.filter((cap) => !provider.descriptor.capabilities.includes(cap));
    if (unsupported.length > 0)
      throw new ValidationError(`${provider.descriptor.id} does not offer: ${unsupported.join(", ")}`);
    const rt = this.#rt();
    const now = Date.now();
    const row: ConnectionRow = {
      id: newId("con"),
      tenantId: c.tenantId,
      provider: provider.descriptor.id,
      name: parsed.name,
      capabilities: [...new Set(capabilities)],
      config: this.#validateConfig(provider, parsed.config ?? {}),
      createdBy: c.userId,
      createdAt: now,
      updatedAt: now,
      lastTest: null,
    };
    await rt.store.insertConnection(row);
    const written = await this.#writeSecrets(rt, c.tenantId, provider, ownerBase(row.id), parsed.credential ?? {});
    await this.#audit(rt, c, "connection.create", row.id, null, {
      provider: row.provider,
      name: row.name,
      capabilities: row.capabilities,
      credentialKeys: written.set,
    });
    return this.#connectionView(rt, row);
  }

  async updateConnection(ctx: TenantCtx, connectionId: string, input: unknown): Promise<Connection> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.update_connection");
    const parsed = parse(UpdateConnectionInputSchema, input);
    const rt = this.#rt();
    const { row, provider } = await this.#connection(rt, c.tenantId, connectionId);
    if (parsed.capabilities) {
      const unsupported = parsed.capabilities.filter((cap) => !provider.descriptor.capabilities.includes(cap));
      if (unsupported.length > 0)
        throw new ValidationError(`${provider.descriptor.id} does not offer: ${unsupported.join(", ")}`);
    }
    await rt.store.updateConnection(c.tenantId, row.id, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.config === undefined ? {} : { config: this.#validateConfig(provider, parsed.config) }),
      ...(parsed.capabilities === undefined ? {} : { capabilities: [...new Set(parsed.capabilities)] }),
      updatedAt: Date.now(),
    });
    await this.#audit(rt, c, "connection.update", row.id, null, { fields: Object.keys(parsed) });
    const updated = await rt.store.getConnection(c.tenantId, row.id);
    if (!updated) throw new NotFoundError("connection not found");
    return this.#connectionView(rt, updated);
  }

  async setConnectionCredential(ctx: TenantCtx, connectionId: string, input: unknown): Promise<Connection> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.rotate_credential");
    const parsed = parse(SetConnectionCredentialInputSchema, input);
    const rt = this.#rt();
    const { row, provider } = await this.#connection(rt, c.tenantId, connectionId);
    const level: ResolutionLevel = parsed.environmentName === null ? "connection-base" : "connection-environment";
    const owner =
      parsed.environmentName === null ? ownerBase(row.id) : ownerEnvironment(row.id, parsed.environmentName);
    if (parsed.environmentName !== null) {
      const existing = (await rt.store.listEnvironmentDefaults(c.tenantId, row.id)).find(
        (d) => d.environmentName === parsed.environmentName,
      );
      await rt.store.upsertEnvironmentDefault({
        connectionId: row.id,
        tenantId: c.tenantId,
        environmentName: parsed.environmentName,
        config: parsed.config === undefined ? (existing?.config ?? {}) : this.#validateConfig(provider, parsed.config),
      });
    } else if (parsed.config !== undefined) {
      await rt.store.updateConnection(c.tenantId, row.id, {
        config: this.#validateConfig(provider, parsed.config),
        updatedAt: Date.now(),
      });
    }
    const written = await this.#writeSecrets(rt, c.tenantId, provider, owner, parsed.values);
    await rt.store.updateConnection(c.tenantId, row.id, { updatedAt: Date.now() });
    await this.#audit(rt, c, "credential.rotate", row.id, level, {
      environmentName: parsed.environmentName,
      set: written.set,
      cleared: written.cleared,
    });
    const updated = await rt.store.getConnection(c.tenantId, row.id);
    if (!updated) throw new NotFoundError("connection not found");
    return this.#connectionView(rt, updated);
  }

  async deleteConnection(ctx: TenantCtx, connectionId: string): Promise<void> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.delete");
    const rt = this.#rt();
    const { row } = await this.#connection(rt, c.tenantId, connectionId);
    const attachments = await rt.store.listAttachmentsForConnection(c.tenantId, row.id);
    await rt.store.deleteConnection(c.tenantId, row.id);
    await this.#audit(rt, c, "connection.delete", row.id, null, {
      provider: row.provider,
      name: row.name,
      detachedProjects: attachments.map((a) => a.projectId),
    });
  }

  async testConnection(ctx: TenantCtx, connectionId: string, environmentName: string | null): Promise<TestResult> {
    const c = this.#tenantCtx(ctx, "tpx.connections.connections.test_connection");
    const envName = environmentName === null ? null : parse(ConnectionEnvironmentNameSchema, environmentName);
    const rt = this.#rt();
    const { row, provider } = await this.#connection(rt, c.tenantId, connectionId);
    if (!provider.test) {
      const at = Date.now();
      await this.#audit(rt, c, "connection.test", row.id, null, {
        environmentName: envName,
        ok: false,
        reason: "no live test",
      });
      return { ok: false, message: `${provider.descriptor.name} has no live test`, at };
    }
    const owners: OwnerRef[] =
      envName === null ? [ownerBase(row.id)] : [ownerEnvironment(row.id, envName), ownerBase(row.id)];
    const secrets = await rt.store.listSecrets(c.tenantId, owners);
    const rowsByLevel: Partial<Record<ResolutionLevel, SecretRow[]>> = {
      "connection-environment": secrets.filter((s) => s.ownerKind === "connection-environment"),
      "connection-base": secrets.filter((s) => s.ownerKind === "connection-base"),
    };
    const chosen = pickInnermost(rowsByLevel);
    const credential = await this.#openSecrets(rt, c.tenantId, chosen);
    const envDefault =
      envName === null
        ? undefined
        : (await rt.store.listEnvironmentDefaults(c.tenantId, row.id)).find((d) => d.environmentName === envName);
    const config = { ...row.config, ...(envDefault?.config ?? {}) };
    const result = await provider.test({ credential, config, fetch: rt.fetch });
    const at = Date.now();
    await rt.store.updateConnection(c.tenantId, row.id, {
      lastTest: { at, ok: result.ok, message: result.message },
      updatedAt: at,
    });
    const level = [...chosen.values()][0]?.level ?? null;
    await this.#audit(rt, c, "connection.test", row.id, level, { environmentName: envName, ok: result.ok });
    return { ok: result.ok, message: result.message, at };
  }

  // -- attachments (project) -----------------------------------------------------------
  async listAttachments(ctx: Ctx): Promise<Attachment[]> {
    const c = this.#scopedCtx(ctx, "tpx.connections.attachments.read");
    const rt = this.#rt();
    const rows = await rt.store.listAttachments(c.tenantId, c.projectId);
    return Promise.all(rows.map((row) => this.#attachmentView(rt, row)));
  }

  async attachConnection(ctx: Ctx, input: unknown): Promise<Attachment> {
    const c = this.#scopedCtx(ctx, "tpx.connections.attachments.attach_connection");
    const parsed = parse(AttachConnectionInputSchema, input);
    const rt = this.#rt();
    const { row: connection } = await this.#connection(rt, c.tenantId, parsed.connectionId);
    if (!connection.capabilities.includes(parsed.capability))
      throw new ValidationError(`${connection.name} does not provide ${parsed.capability}`);
    const siblings = (await rt.store.listAttachments(c.tenantId, c.projectId)).filter(
      (a) => a.capability === parsed.capability,
    );
    const now = Date.now();
    const row: AttachmentRow = {
      id: newId("att"),
      tenantId: c.tenantId,
      projectId: c.projectId,
      connectionId: connection.id,
      name: parsed.name ?? slugify(connection.name),
      capability: parsed.capability,
      isDefault: parsed.isDefault ?? siblings.length === 0,
      config: {},
      createdAt: now,
      updatedAt: now,
    };
    const inserted = await rt.store.insertAttachment(row);
    if (!inserted)
      throw new ConflictError(
        `an attachment named ${JSON.stringify(row.name)} already provides ${row.capability} here`,
      );
    if (row.isDefault) await rt.store.setDefaultAttachment(c.tenantId, c.projectId, row.capability, row.id);
    await this.#audit(rt, c, "attachment.create", row.id, null, {
      connectionId: connection.id,
      capability: row.capability,
      name: row.name,
      isDefault: row.isDefault,
    });
    const stored = await rt.store.getAttachment(c.tenantId, row.id);
    return this.#attachmentView(rt, stored ?? row);
  }

  async updateAttachment(ctx: Ctx, attachmentId: string, input: unknown): Promise<Attachment> {
    const c = this.#scopedCtx(ctx, "tpx.connections.attachments.update_attachment");
    const parsed = parse(UpdateAttachmentInputSchema, input);
    const rt = this.#rt();
    const row = await this.#attachment(rt, c, attachmentId);
    const { provider } = await this.#connection(rt, c.tenantId, row.connectionId);
    await rt.store.updateAttachment(c.tenantId, row.id, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.config === undefined ? {} : { config: this.#validateConfig(provider, parsed.config) }),
      updatedAt: Date.now(),
    });
    if (parsed.isDefault === true) await rt.store.setDefaultAttachment(c.tenantId, c.projectId, row.capability, row.id);
    if (parsed.isDefault === false)
      await rt.store.updateAttachment(c.tenantId, row.id, { isDefault: false, updatedAt: Date.now() });
    const written = parsed.credential
      ? await this.#writeSecrets(rt, c.tenantId, provider, ownerAttachment(row.id), parsed.credential)
      : { set: [], cleared: [] };
    await this.#audit(rt, c, "attachment.update", row.id, parsed.credential ? "attachment" : null, {
      fields: Object.keys(parsed),
      set: written.set,
      cleared: written.cleared,
    });
    const updated = await rt.store.getAttachment(c.tenantId, row.id);
    if (!updated) throw new NotFoundError("attachment not found");
    return this.#attachmentView(rt, updated);
  }

  async detachConnection(ctx: Ctx, attachmentId: string): Promise<void> {
    const c = this.#scopedCtx(ctx, "tpx.connections.attachments.detach_connection");
    const rt = this.#rt();
    const row = await this.#attachment(rt, c, attachmentId);
    await rt.store.deleteAttachment(c.tenantId, row.id);
    await this.#audit(rt, c, "attachment.delete", row.id, null, {
      connectionId: row.connectionId,
      capability: row.capability,
      name: row.name,
    });
  }

  // -- bindings (environment) ----------------------------------------------------------
  async getBinding(ctx: Ctx, attachmentId: string): Promise<Binding | null> {
    const c = this.#scopedCtx(ctx, "tpx.connections.bindings.read");
    const rt = this.#rt();
    const attachment = await this.#attachment(rt, c, attachmentId);
    const row = await rt.store.getBinding(c.tenantId, attachment.id, c.environmentId);
    const secrets = await rt.store.listSecrets(c.tenantId, [ownerBinding(attachment.id, c.environmentId)]);
    if (!row && secrets.length === 0) return null;
    return this.#bindingView(
      rt,
      row ?? {
        attachmentId: attachment.id,
        environmentId: c.environmentId,
        tenantId: c.tenantId,
        projectId: c.projectId,
        config: {},
        updatedAt: 0,
      },
    );
  }

  async setBinding(ctx: Ctx, attachmentId: string, input: unknown): Promise<Binding> {
    const c = this.#scopedCtx(ctx, "tpx.connections.bindings.update_binding");
    const parsed = parse(SetBindingInputSchema, input);
    const rt = this.#rt();
    const attachment = await this.#attachment(rt, c, attachmentId);
    const { provider } = await this.#connection(rt, c.tenantId, attachment.connectionId);
    const existing = await rt.store.getBinding(c.tenantId, attachment.id, c.environmentId);
    const row: BindingRow = {
      attachmentId: attachment.id,
      environmentId: c.environmentId,
      tenantId: c.tenantId,
      projectId: c.projectId,
      config: parsed.config === undefined ? (existing?.config ?? {}) : this.#validateConfig(provider, parsed.config),
      updatedAt: Date.now(),
    };
    await rt.store.upsertBinding(row);
    const written = parsed.credential
      ? await this.#writeSecrets(
          rt,
          c.tenantId,
          provider,
          ownerBinding(attachment.id, c.environmentId),
          parsed.credential,
        )
      : { set: [], cleared: [] };
    await this.#audit(rt, c, "binding.update", attachment.id, "binding", {
      fields: Object.keys(parsed),
      set: written.set,
      cleared: written.cleared,
    });
    return this.#bindingView(rt, row);
  }

  async clearBinding(ctx: Ctx, attachmentId: string): Promise<void> {
    const c = this.#scopedCtx(ctx, "tpx.connections.bindings.clear_binding");
    const rt = this.#rt();
    const attachment = await this.#attachment(rt, c, attachmentId);
    await rt.store.deleteBinding(c.tenantId, attachment.id, c.environmentId);
    await rt.store.deleteSecretsForOwner(c.tenantId, ownerBinding(attachment.id, c.environmentId));
    await this.#audit(rt, c, "binding.clear", attachment.id, "binding");
  }

  async #plan(
    rt: Runtime,
    c: Ctx,
    attachment: AttachmentRow,
    toEnvironmentId: string,
  ): Promise<{
    plan: PromotionPlan;
    from: { config: Record<string, string>; secrets: SecretRow[] };
    to: { config: Record<string, string>; secrets: SecretRow[] };
  }> {
    const fromOwner = ownerBinding(attachment.id, c.environmentId);
    const toOwner = ownerBinding(attachment.id, toEnvironmentId);
    const [fromBinding, toBinding, secrets] = await Promise.all([
      rt.store.getBinding(c.tenantId, attachment.id, c.environmentId),
      rt.store.getBinding(c.tenantId, attachment.id, toEnvironmentId),
      rt.store.listSecrets(c.tenantId, [fromOwner, toOwner]),
    ]);
    const from = { config: fromBinding?.config ?? {}, secrets: secrets.filter((s) => sameOwner(s, fromOwner)) };
    const to = { config: toBinding?.config ?? {}, secrets: secrets.filter((s) => sameOwner(s, toOwner)) };
    const keys = new Set([
      ...Object.keys(from.config),
      ...Object.keys(to.config),
      ...from.secrets.map((s) => s.key),
      ...to.secrets.map((s) => s.key),
    ]);
    const changes: PromotionPlan["changes"] = [];
    for (const key of [...keys].sort()) {
      const fromSecret = from.secrets.find((s) => s.key === key);
      const toSecret = to.secrets.find((s) => s.key === key);
      if (fromSecret || toSecret) {
        changes.push({
          key,
          secret: true,
          from: fromSecret ? { set: true, hint: fromSecret.hint, updatedAt: fromSecret.updatedAt } : { set: false },
          to: toSecret ? { set: true, hint: toSecret.hint, updatedAt: toSecret.updatedAt } : { set: false },
          action: fromSecret ? "copy" : "clear",
        });
        continue;
      }
      const fromValue = from.config[key];
      const toValue = to.config[key];
      changes.push({
        key,
        secret: false,
        from: fromValue === undefined ? { set: false } : { set: true, value: fromValue },
        to: toValue === undefined ? { set: false } : { set: true, value: toValue },
        action: fromValue === undefined ? "clear" : fromValue === toValue ? "unchanged" : "copy",
      });
    }
    const digest = await sha256Hex(
      JSON.stringify({ attachmentId: attachment.id, from: c.environmentId, to: toEnvironmentId, changes }),
    );
    return {
      plan: { attachmentId: attachment.id, fromEnvironmentId: c.environmentId, toEnvironmentId, changes, digest },
      from,
      to,
    };
  }

  async planPromotion(ctx: Ctx, attachmentId: string, toEnvironmentId: string): Promise<PromotionPlan> {
    const c = this.#scopedCtx(ctx, "tpx.connections.bindings.promote_binding");
    const target = parse(IdSchema, toEnvironmentId);
    if (target === c.environmentId) throw new ValidationError("cannot promote an environment onto itself");
    const rt = this.#rt();
    const attachment = await this.#attachment(rt, c, attachmentId);
    return (await this.#plan(rt, c, attachment, target)).plan;
  }

  async promote(ctx: Ctx, input: { attachmentId: string; toEnvironmentId: string; digest: string }): Promise<Binding> {
    const c = this.#scopedCtx(ctx, "tpx.connections.bindings.promote_binding");
    const parsed = parse(
      z.object({ attachmentId: IdSchema, toEnvironmentId: IdSchema, digest: z.string().length(64) }),
      input,
    );
    if (parsed.toEnvironmentId === c.environmentId)
      throw new ValidationError("cannot promote an environment onto itself");
    const rt = this.#rt();
    const attachment = await this.#attachment(rt, c, parsed.attachmentId);
    const { plan, from, to } = await this.#plan(rt, c, attachment, parsed.toEnvironmentId);
    if (!timingSafeEqual(plan.digest, parsed.digest))
      throw new ConflictError("the promotion plan changed since it was reviewed; reload and confirm again");
    const keys = await rt.keys;
    const toOwner = ownerBinding(attachment.id, parsed.toEnvironmentId);
    const row: BindingRow = {
      attachmentId: attachment.id,
      environmentId: parsed.toEnvironmentId,
      tenantId: c.tenantId,
      projectId: c.projectId,
      config: { ...from.config },
      updatedAt: Date.now(),
    };
    await rt.store.upsertBinding(row);
    for (const secret of from.secrets) {
      const plaintext = await open(
        keys,
        aadFor({
          tenantId: c.tenantId,
          ownerKind: secret.ownerKind,
          ownerId: secret.ownerId,
          environmentKey: secret.environmentKey,
          key: secret.key,
        }),
        secret,
      );
      const envelope = await seal(keys, aadFor({ tenantId: c.tenantId, ...toOwner, key: secret.key }), plaintext);
      const now = Date.now();
      await rt.store.upsertSecret({
        id: newId("sec"),
        tenantId: c.tenantId,
        ...toOwner,
        key: secret.key,
        ...envelope,
        createdAt: now,
        updatedAt: now,
      });
    }
    for (const secret of to.secrets) {
      if (!from.secrets.some((s) => s.key === secret.key)) await rt.store.deleteSecret(c.tenantId, toOwner, secret.key);
    }
    await this.#audit(rt, c, "binding.promote", attachment.id, "binding", {
      toEnvironmentId: parsed.toEnvironmentId,
      digest: plan.digest,
      copied: plan.changes.filter((ch) => ch.action === "copy").map((ch) => ch.key),
      cleared: plan.changes.filter((ch) => ch.action === "clear").map((ch) => ch.key),
    });
    return this.#bindingView(rt, row);
  }

  // -- resolution and execution ----------------------------------------------------------
  async resolve(ctx: Ctx, capability: Capability, attachmentName?: string): Promise<Resolution> {
    const c = this.#scopedCtx(ctx, "tpx.connections.usage.read");
    const cap = parse(CapabilitySchema, capability);
    const rt = this.#rt();
    const attachment = await this.#findAttachment(rt, c, cap, attachmentName);
    if (!attachment) return { capability: cap, attachment: null, available: false, fields: [], missing: [] };
    const { connection, provider, levels } = await this.#gather(rt, c, attachment);
    const fields = resolveFields(provider.descriptor, levels);
    const missing = missingRequired(fields);
    return {
      capability: cap,
      attachment: {
        id: attachment.id,
        name: attachment.name,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
      },
      available: missing.length === 0,
      fields,
      missing,
    };
  }

  async execute(
    ctx: Ctx,
    capability: Capability,
    attachmentName: string | null,
    op: string,
    args: unknown,
  ): Promise<ExecuteResult> {
    const c = this.#scopedCtx(ctx, "tpx.connections.usage.execute_capability");
    const cap = parse(CapabilitySchema, capability);
    const operation = parse(z.string().min(1).max(64), op);
    const rt = this.#rt();
    const attachment = await this.#findAttachment(rt, c, cap, attachmentName ?? undefined);
    if (!attachment) return { ok: false, error: `no attachment provides ${cap} in this scope`, suppliedBy: null };
    const { connection, provider, levels, secretRowsByLevel } = await this.#gather(rt, c, attachment);
    const fields = resolveFields(provider.descriptor, levels);
    const missing = missingRequired(fields);
    if (missing.length > 0)
      return { ok: false, error: `unavailable in this scope: missing ${missing.join(", ")}`, suppliedBy: null };
    const chosen = pickInnermost(secretRowsByLevel);
    const credential = await this.#openSecrets(rt, c.tenantId, chosen);
    const config: Record<string, string> = {};
    for (const field of fields) if (!field.secret && field.value !== undefined) config[field.key] = field.value;
    const level = [...chosen.values()][0]?.level ?? null;
    const levelsByKey = Object.fromEntries([...chosen].map(([key, { level: lvl }]) => [key, lvl]));
    try {
      let result: unknown;
      if (operation === "test") {
        if (!provider.test) throw new Error(`${provider.descriptor.name} has no live test`);
        result = await provider.test({ credential, config, fetch: rt.fetch });
      } else {
        if (!provider.execute) throw new Error(`${provider.descriptor.name} does not implement ${operation}`);
        result = await provider.execute(operation, args, { credential, config, fetch: rt.fetch });
      }
      await this.#audit(rt, c, "capability.execute", attachment.id, level, {
        capability: cap,
        op: operation,
        connectionId: connection.id,
        ok: true,
        levels: levelsByKey,
      });
      return { ok: true, result, suppliedBy: level };
    } catch (error) {
      const message = error instanceof Error ? error.message : "execution failed";
      await this.#audit(rt, c, "capability.execute", attachment.id, level, {
        capability: cap,
        op: operation,
        connectionId: connection.id,
        ok: false,
        error: message,
        levels: levelsByKey,
      });
      return { ok: false, error: message, suppliedBy: level };
    }
  }

  async revealSecret(ctx: Ctx, locator: SecretLocator, key: string): Promise<RevealedSecret> {
    const c = this.#scopedCtx(ctx, "tpx.connections.connections.reveal_secret");
    const loc = parse(SecretLocatorSchema, locator);
    const fieldKey = parse(z.string().min(1).max(64), key);
    const rt = this.#rt();
    let owner: OwnerRef;
    switch (loc.level) {
      case "connection-base": {
        const { row } = await this.#connection(rt, c.tenantId, loc.connectionId);
        owner = ownerBase(row.id);
        break;
      }
      case "connection-environment": {
        const { row } = await this.#connection(rt, c.tenantId, loc.connectionId);
        owner = ownerEnvironment(row.id, loc.environmentName);
        break;
      }
      case "attachment": {
        const att = await this.#attachment(rt, c, loc.attachmentId);
        owner = ownerAttachment(att.id);
        break;
      }
      case "binding": {
        const att = await this.#attachment(rt, c, loc.attachmentId);
        owner = ownerBinding(att.id, loc.environmentId);
        break;
      }
    }
    const row = (await rt.store.listSecrets(c.tenantId, [owner])).find((s) => s.key === fieldKey);
    if (!row) throw new NotFoundError("no such secret at that level");
    const value = await open(await rt.keys, aadFor({ tenantId: c.tenantId, ...owner, key: fieldKey }), row);
    await this.#audit(rt, c, "secret.reveal", owner.ownerId, loc.level, {
      key: fieldKey,
      environmentKey: owner.environmentKey,
    });
    return { key: fieldKey, value, suppliedBy: loc.level };
  }

  // -- audit ----------------------------------------------------------------------------
  async listAudit(ctx: TenantCtx, options?: { limit?: number; projectId?: string }): Promise<ConnectionsAuditEntry[]> {
    const c = this.#tenantCtx(ctx, "tpx.connections.audit.read");
    const limit = Math.min(Math.max(1, Math.trunc(options?.limit ?? AUDIT_LIMIT_DEFAULT)), AUDIT_LIMIT_MAX);
    const rt = this.#rt();
    const rows = await rt.store.listAudit(c.tenantId, {
      limit,
      ...(options?.projectId === undefined ? {} : { projectId: parse(IdSchema, options.projectId) }),
    });
    return rows.map((r) => ({ ...r, level: (r.level as ResolutionLevel | null) ?? null }));
  }
}

/** Every ForbiddenError thrown above names its permission; re-exported for tests. */
export { ForbiddenError };
