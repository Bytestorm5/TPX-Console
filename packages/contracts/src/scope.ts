/**
 * The scope model. Three levels, always present, never optional:
 *
 *   Tenant      — the billing and identity boundary (a Clerk organization)
 *   Project     — a unit of delivered work
 *   Environment — a target within a project
 *
 * tpx-web resolves the identity at ingress and passes a `Ctx` inward on every
 * call: by RPC argument during SSR, by the `x-tpx-ctx` header on the
 * `/api/<product>/*` path. Services trust the context they receive because
 * nothing else can call them — and still parse it, because a malformed
 * context is a programming error worth failing loudly on.
 */
import { z } from "zod";

export const IdSchema = z.string().min(1).max(128);

/** URL-safe project identifiers: lowercase, digits and single hyphens. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "lowercase letters, digits and hyphens only")
  .refine((s) => !s.includes("--"), "no consecutive hyphens");

/** Environment names are tenant vocabulary: `prod`, `dev`, `stage`. */
export const EnvironmentNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "lowercase, starting with a letter");

export const ScopeSchema = z.object({
  tenantId: IdSchema,
  projectId: IdSchema,
  environmentId: IdSchema,
});
export type Scope = z.infer<typeof ScopeSchema>;

/** Permission keys held by the caller AT the request's scope (see @tpx/identity). */
export const GrantsSchema = z.array(z.string().min(1).max(160)).max(1024);

/** The context for tenant-level operations (before or outside any project). */
export const TenantCtxSchema = z.object({
  tenantId: IdSchema,
  userId: IdSchema,
  grants: GrantsSchema,
});
export type TenantCtx = z.infer<typeof TenantCtxSchema>;

/** The full context: the scope triple plus who is acting and what they hold there. */
export const CtxSchema = TenantCtxSchema.extend({
  projectId: IdSchema,
  environmentId: IdSchema,
  /** The environment's name in the tenant vocabulary — connection defaults are keyed by it. */
  environmentName: EnvironmentNameSchema,
});
export type Ctx = z.infer<typeof CtxSchema>;

export function parseCtx(input: unknown): Ctx {
  return CtxSchema.parse(input);
}

export function parseTenantCtx(input: unknown): TenantCtx {
  return TenantCtxSchema.parse(input);
}

export function scopeOf(ctx: Ctx): Scope {
  return { tenantId: ctx.tenantId, projectId: ctx.projectId, environmentId: ctx.environmentId };
}

/** The header tpx-web forwards a context on for `/api/<product>/*` requests. */
export const CTX_HEADER = "x-tpx-ctx";

export function encodeCtxHeader(ctx: Ctx): string {
  return JSON.stringify(CtxSchema.parse(ctx));
}

/** Returns `null` for an absent header; throws on a present-but-invalid one. */
export function decodeCtxHeader(value: string | null | undefined): Ctx | null {
  if (value === null || value === undefined || value === "") return null;
  return CtxSchema.parse(JSON.parse(value));
}
