/**
 * A minimal, typed client for Convex's documented HTTP API:
 *
 *   POST {CONVEX_URL}/api/query | /api/mutation
 *   Authorization: Convex <deploy key>
 *   { "path": "module:function", "args": {...}, "format": "json" }
 *
 * The deploy key makes the call an admin call, which is what lets every
 * function in convex/ stay `internal*` — nothing is reachable from a browser.
 * `format: "json"` keeps values plain JSON; this service never uses Convex's
 * int64 or bytes types.
 */
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";

export interface ConvexCaller {
  query<Ref extends FunctionReference<"query", "internal" | "public">>(
    ref: Ref,
    args: FunctionArgs<Ref>,
  ): Promise<FunctionReturnType<Ref>>;
  mutation<Ref extends FunctionReference<"mutation", "internal" | "public">>(
    ref: Ref,
    args: FunctionArgs<Ref>,
  ): Promise<FunctionReturnType<Ref>>;
}

export class ConvexCallError extends Error {
  readonly path: string;
  readonly errorData: unknown;
  constructor(path: string, message: string, errorData?: unknown) {
    super(message);
    this.name = "ConvexCallError";
    this.path = path;
    this.errorData = errorData;
  }
}

/** Convex rejects `undefined` values; drop them the way the official client does for object fields. */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripUndefined(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      if (val !== undefined) out[k] = stripUndefined(val);
    }
    return out as T;
  }
  return value;
}

export interface ConvexHttpOptions {
  url: string;
  deployKey: string;
  fetch?: typeof globalThis.fetch;
}

export function createConvexCaller(options: ConvexHttpOptions): ConvexCaller {
  const base = options.url.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call(
    kind: "query" | "mutation",
    ref: FunctionReference<"query" | "mutation", "internal" | "public">,
    args: unknown,
  ): Promise<unknown> {
    const path = getFunctionName(ref);
    const response = await doFetch(`${base}/api/${kind}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Convex ${options.deployKey}`,
      },
      body: JSON.stringify({ path, args: stripUndefined(args ?? {}), format: "json" }),
    });
    type Body = { status?: string; value?: unknown; errorMessage?: string; errorData?: unknown };
    const body = await response.json().then(
      (json) => json as Body,
      () => null,
    );
    if (!response.ok || !body || body.status !== "success") {
      throw new ConvexCallError(
        path,
        body?.errorMessage ?? `Convex ${kind} ${path} failed with HTTP ${response.status}`,
        body?.errorData,
      );
    }
    return body.value;
  }

  return {
    query: (ref, args) => call("query", ref, args) as never,
    mutation: (ref, args) => call("mutation", ref, args) as never,
  };
}

/** Shallowly removes `undefined`-valued optional properties at the type level, to hand Alfiz-shaped inputs to Convex validators. */
export type Compact<T> = { [K in keyof T]: Exclude<T[K], undefined> };
export function compact<T extends object>(value: T): Compact<T> {
  return stripUndefined(value) as Compact<T>;
}

/** Convex returns `null` for functions without a return value; the store seam wants `void`. */
export async function voided(promise: Promise<unknown>): Promise<void> {
  await promise;
}
