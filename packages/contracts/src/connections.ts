/**
 * The connections service — credentials, connector implementations,
 * capability contracts, scope resolution, and the audit log.
 *
 * A connection is three objects, not one:
 *   Connection  (tenant)                 provider, capabilities, base credential/config,
 *                                        per-environment defaults keyed by environment NAME
 *   Attachment  (connection × project)   this project may use it; project-wide overrides
 *   Binding     (attachment × environment) this project's overrides for this environment
 *
 * Resolution is innermost-first: binding → attachment → connection environment
 * default → connection base. Secrets never leave the service except through
 * `revealSecret`, which is separately permissioned and audited.
 */
import { z } from "zod";
import { EnvironmentNameSchema, IdSchema, SlugSchema, type Ctx, type TenantCtx } from "./scope.ts";
import type { ProductCapabilities } from "./product.ts";

export const CAPABILITIES = ["dns", "cdn", "storage", "scm", "tickets", "email", "llm", "webhook"] as const;
export const CapabilitySchema = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof CapabilitySchema>;

export const FieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const FieldSpecSchema = z.object({
  key: FieldKeySchema,
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
});
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

/** What the marketplace lists. Providers are code, not rows. */
export const ProviderDescriptorSchema = z.object({
  id: SlugSchema,
  name: z.string(),
  description: z.string(),
  capabilities: z.array(CapabilitySchema).min(1),
  /** Credential fields: `secret: true` values are encrypted at rest and never read back. */
  credentialFields: z.array(FieldSpecSchema),
  /** Non-secret configuration (zone id, bucket name, repository …). */
  configFields: z.array(FieldSpecSchema),
  docsUrl: z.string().url().optional(),
  /** A Lucide icon name for the marketplace tile. */
  icon: z.string(),
  /** Whether the provider implements a live `test` call. */
  testable: z.boolean(),
});
export type ProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>;

export const RESOLUTION_LEVELS = ["binding", "attachment", "connection-environment", "connection-base"] as const;
export const ResolutionLevelSchema = z.enum(RESOLUTION_LEVELS);
export type ResolutionLevel = z.infer<typeof ResolutionLevelSchema>;

/** A secret as the console sees it: set or not, plus a trailing-character hint. Never the value. */
export const SecretHintSchema = z.object({
  set: z.boolean(),
  hint: z.string().max(8).optional(),
  updatedAt: z.number().int().optional(),
});
export type SecretHint = z.infer<typeof SecretHintSchema>;

export const ValuesSchema = z.record(FieldKeySchema, z.string().max(8192));
export type Values = z.infer<typeof ValuesSchema>;
export const HintsSchema = z.record(FieldKeySchema, SecretHintSchema);
export type Hints = z.infer<typeof HintsSchema>;

export const ConnectionSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  provider: SlugSchema,
  name: z.string().min(1).max(120),
  capabilities: z.array(CapabilitySchema).min(1),
  config: ValuesSchema,
  credential: HintsSchema,
  /** Keyed by environment NAME (tenant vocabulary), not by environment id. */
  environmentDefaults: z.record(EnvironmentNameSchema, z.object({ config: ValuesSchema, credential: HintsSchema })),
  createdBy: IdSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  lastTest: z.object({ at: z.number().int(), ok: z.boolean(), message: z.string() }).nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const CreateConnectionInputSchema = z.object({
  provider: SlugSchema,
  name: z.string().trim().min(1).max(120),
  /** Defaults to everything the provider offers. */
  capabilities: z.array(CapabilitySchema).min(1).optional(),
  config: ValuesSchema.optional(),
  /** Plaintext on the way in only. */
  credential: ValuesSchema.optional(),
});
export type CreateConnectionInput = z.infer<typeof CreateConnectionInputSchema>;

export const UpdateConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: ValuesSchema.optional(),
  capabilities: z.array(CapabilitySchema).min(1).optional(),
});
export type UpdateConnectionInput = z.infer<typeof UpdateConnectionInputSchema>;

/** Set (or rotate) credential values at the connection base or at an environment default. */
export const SetConnectionCredentialInputSchema = z.object({
  /** `null` targets the base credential. */
  environmentName: EnvironmentNameSchema.nullable(),
  values: ValuesSchema,
  /** Non-secret config at the same level, if any. */
  config: ValuesSchema.optional(),
});
export type SetConnectionCredentialInput = z.infer<typeof SetConnectionCredentialInputSchema>;

export const AttachmentSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema,
  connectionId: IdSchema,
  /** Named so a project can attach two buckets, two zones. */
  name: SlugSchema,
  capability: CapabilitySchema,
  isDefault: z.boolean(),
  config: ValuesSchema,
  credential: HintsSchema,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachConnectionInputSchema = z.object({
  connectionId: IdSchema,
  capability: CapabilitySchema,
  name: SlugSchema.optional(),
  isDefault: z.boolean().optional(),
});
export type AttachConnectionInput = z.infer<typeof AttachConnectionInputSchema>;

export const UpdateAttachmentInputSchema = z.object({
  name: SlugSchema.optional(),
  isDefault: z.boolean().optional(),
  config: ValuesSchema.optional(),
  /** Plaintext override values; an empty string clears a key. */
  credential: ValuesSchema.optional(),
});
export type UpdateAttachmentInput = z.infer<typeof UpdateAttachmentInputSchema>;

export const BindingSchema = z.object({
  attachmentId: IdSchema,
  environmentId: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema,
  config: ValuesSchema,
  credential: HintsSchema,
  updatedAt: z.number().int(),
});
export type Binding = z.infer<typeof BindingSchema>;

export const SetBindingInputSchema = z.object({
  config: ValuesSchema.optional(),
  credential: ValuesSchema.optional(),
});
export type SetBindingInput = z.infer<typeof SetBindingInputSchema>;

/** One resolved field with the level that supplied it. Secret values are never included. */
export const ResolvedFieldSchema = z.object({
  key: FieldKeySchema,
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  set: z.boolean(),
  suppliedBy: ResolutionLevelSchema.nullable(),
  value: z.string().optional(),
  hint: z.string().optional(),
});
export type ResolvedField = z.infer<typeof ResolvedFieldSchema>;

export const ResolutionSchema = z.object({
  capability: CapabilitySchema,
  attachment: z
    .object({
      id: IdSchema,
      name: SlugSchema,
      connectionId: IdSchema,
      connectionName: z.string(),
      provider: SlugSchema,
    })
    .nullable(),
  /** False when nothing in the chain supplies a required value — the UI says so up front. */
  available: z.boolean(),
  fields: z.array(ResolvedFieldSchema),
  missing: z.array(FieldKeySchema),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const RevealedSecretSchema = z.object({
  key: FieldKeySchema,
  value: z.string(),
  suppliedBy: ResolutionLevelSchema,
});
export type RevealedSecret = z.infer<typeof RevealedSecretSchema>;

/** Where a secret lives; used by `revealSecret` and `rotateSecret`. */
export const SecretLocatorSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("connection-base"), connectionId: IdSchema }),
  z.object({
    level: z.literal("connection-environment"),
    connectionId: IdSchema,
    environmentName: EnvironmentNameSchema,
  }),
  z.object({ level: z.literal("attachment"), attachmentId: IdSchema }),
  z.object({ level: z.literal("binding"), attachmentId: IdSchema, environmentId: IdSchema }),
]);
export type SecretLocator = z.infer<typeof SecretLocatorSchema>;

/** The diffed, confirmed promotion of one attachment's values from one environment to another. */
export const PromotionChangeSchema = z.object({
  key: FieldKeySchema,
  secret: z.boolean(),
  from: SecretHintSchema.extend({ value: z.string().optional() }),
  to: SecretHintSchema.extend({ value: z.string().optional() }),
  action: z.enum(["copy", "unchanged", "clear"]),
});
export const PromotionPlanSchema = z.object({
  attachmentId: IdSchema,
  fromEnvironmentId: IdSchema,
  toEnvironmentId: IdSchema,
  changes: z.array(PromotionChangeSchema),
  /** Confirming a promotion requires echoing this digest; a changed plan is refused. */
  digest: z.string(),
});
export type PromotionPlan = z.infer<typeof PromotionPlanSchema>;

export const ConnectionsAuditEntrySchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  projectId: IdSchema.nullable(),
  environmentId: IdSchema.nullable(),
  userId: IdSchema,
  action: z.string(),
  target: z.string(),
  /** Which level supplied the credential, for executions and reveals. */
  level: ResolutionLevelSchema.nullable(),
  at: z.number().int(),
  detail: z.unknown().optional(),
});
export type ConnectionsAuditEntry = z.infer<typeof ConnectionsAuditEntrySchema>;

export const TestResultSchema = z.object({ ok: z.boolean(), message: z.string(), at: z.number().int() });
export type TestResult = z.infer<typeof TestResultSchema>;

export const ExecuteResultSchema = z.object({
  ok: z.boolean(),
  /** Provider-specific, JSON-serialisable. */
  result: z.unknown().optional(),
  error: z.string().optional(),
  suppliedBy: ResolutionLevelSchema.nullable(),
});
export type ExecuteResult = z.infer<typeof ExecuteResultSchema>;

/**
 * The connections service's interface (`services/connections`), what the
 * shell calls in-process. Tenant-level objects take a `TenantCtx`; anything
 * project- or environment-shaped takes the full `Ctx`. Products never name a
 * connection: they ask for a capability within a scope.
 */
export interface ConnectionsServiceContract {
  capabilities(): Promise<ProductCapabilities>;
  listProviders(): Promise<ProviderDescriptor[]>;

  listConnections(ctx: TenantCtx): Promise<Connection[]>;
  getConnection(ctx: TenantCtx, connectionId: string): Promise<Connection>;
  createConnection(ctx: TenantCtx, input: CreateConnectionInput): Promise<Connection>;
  updateConnection(ctx: TenantCtx, connectionId: string, input: UpdateConnectionInput): Promise<Connection>;
  setConnectionCredential(
    ctx: TenantCtx,
    connectionId: string,
    input: SetConnectionCredentialInput,
  ): Promise<Connection>;
  deleteConnection(ctx: TenantCtx, connectionId: string): Promise<void>;
  testConnection(ctx: TenantCtx, connectionId: string, environmentName: string | null): Promise<TestResult>;

  listAttachments(ctx: Ctx): Promise<Attachment[]>;
  attachConnection(ctx: Ctx, input: AttachConnectionInput): Promise<Attachment>;
  updateAttachment(ctx: Ctx, attachmentId: string, input: UpdateAttachmentInput): Promise<Attachment>;
  detachConnection(ctx: Ctx, attachmentId: string): Promise<void>;

  getBinding(ctx: Ctx, attachmentId: string): Promise<Binding | null>;
  setBinding(ctx: Ctx, attachmentId: string, input: SetBindingInput): Promise<Binding>;
  clearBinding(ctx: Ctx, attachmentId: string): Promise<void>;
  planPromotion(ctx: Ctx, attachmentId: string, toEnvironmentId: string): Promise<PromotionPlan>;
  promote(ctx: Ctx, plan: { attachmentId: string; toEnvironmentId: string; digest: string }): Promise<Binding>;

  /** The resolved view (no secret values) with the level that supplied each field. */
  resolve(ctx: Ctx, capability: Capability, attachmentName?: string): Promise<Resolution>;
  /** Executes a provider operation with the resolved credential; secrets stay inside. */
  execute(
    ctx: Ctx,
    capability: Capability,
    attachmentName: string | null,
    op: string,
    args: unknown,
  ): Promise<ExecuteResult>;
  /** Separately permissioned (`reveal_secret`), always audited, one key at a time. */
  revealSecret(ctx: Ctx, locator: SecretLocator, key: string): Promise<RevealedSecret>;

  listAudit(ctx: TenantCtx, options?: { limit?: number; projectId?: string }): Promise<ConnectionsAuditEntry[]>;
}
