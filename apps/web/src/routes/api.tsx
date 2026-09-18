import type { Route } from "./+types/api";
import { PRODUCT_IDS } from "@tpx/contracts/product";
import { cloudflareContext } from "../shell/context.ts";
import type { ServiceId } from "../shell/manifest.ts";
import { resolveScopeSession } from "../shell/session.server.ts";

/**
 * The API forwarder: `/api/<product>/*` → the product's service, in-process,
 * with the resolved context as an argument. The scope comes from the
 * `x-tpx-project` and `x-tpx-environment` headers (project slug, environment
 * name); a request whose scope the user has no grant for is rejected here,
 * before any service sees it. The service gets a request whose URL is
 * relative to the product root and that carries only the headers below.
 */
const SERVICES: Record<string, ServiceId> = { workspace: "auth", connections: "connections" };
const FORWARDED_HEADERS = ["accept", "content-type", "content-length", "x-request-id"];

async function forward(args: Route.LoaderArgs | Route.ActionArgs): Promise<Response> {
  const { services } = args.context.get(cloudflareContext);
  const product = args.params.product;
  const serviceId = (PRODUCT_IDS as readonly string[]).includes(product) ? SERVICES[product] : undefined;
  if (!serviceId) return new Response("unknown product", { status: 404 });
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
  const init: RequestInit = { method: args.request.method, headers };
  if (args.request.method !== "GET" && args.request.method !== "HEAD") init.body = await args.request.arrayBuffer();
  return services[serviceId].handle(session.ctx, new Request(target, init));
}

export const loader = forward;
export const action = forward;
