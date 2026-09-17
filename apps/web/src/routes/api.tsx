import type { Route } from "./+types/api";
import { PRODUCT_IDS } from "@tpx/contracts/product";
import { CTX_HEADER, encodeCtxHeader } from "@tpx/contracts/scope";
import { cloudflareContext } from "../shell/context.ts";
import { resolveScopeSession } from "../shell/session.server.ts";

/**
 * The API forwarder: `/api/<product>/*` → the product's service binding, with
 * the resolved context on the `x-tpx-ctx` header. The scope comes from the
 * `x-tpx-project` and `x-tpx-environment` headers (project slug, environment
 * name); a request whose scope the user has no grant for is rejected here,
 * before any service sees it.
 */
const BINDINGS: Record<string, "AUTH" | "CONNECTIONS"> = { workspace: "AUTH", connections: "CONNECTIONS" };
const FORWARDED_HEADERS = ["accept", "content-type", "content-length", "x-request-id"];

async function forward(args: Route.LoaderArgs | Route.ActionArgs): Promise<Response> {
  const { env } = args.context.get(cloudflareContext);
  const product = args.params.product;
  if (!(PRODUCT_IDS as readonly string[]).includes(product) || !BINDINGS[product])
    return new Response("unknown product", { status: 404 });
  const binding = env[BINDINGS[product]];
  const projectSlug = args.request.headers.get("x-tpx-project");
  const environmentName = args.request.headers.get("x-tpx-environment");
  if (!projectSlug) return new Response("x-tpx-project header required", { status: 400 });
  const session = await resolveScopeSession(args, projectSlug, environmentName);
  const incoming = new URL(args.request.url);
  const target = new URL(`https://${product}.internal/${args.params["*"] ?? ""}${incoming.search}`);
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = args.request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(CTX_HEADER, encodeCtxHeader(session.ctx));
  const init: RequestInit = { method: args.request.method, headers };
  if (args.request.method !== "GET" && args.request.method !== "HEAD") init.body = await args.request.arrayBuffer();
  return binding.fetch(target, init);
}

export const loader = forward;
export const action = forward;
