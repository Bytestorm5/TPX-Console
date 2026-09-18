/**
 * The console's one Worker. It serves the assets and the SSR app, and mounts
 * every service (`services/*`) in-process: the entry constructs them with the
 * Worker's env and hands them to the router, where loaders, actions and the
 * `/api/<product>/*` forwarder call them directly.
 */
import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { cloudflareContext } from "../src/shell/context.ts";
import type { WebEnv } from "../src/shell/env.ts";
import { servicesFor } from "../src/shell/services.server.ts";

// The virtual build's optional fields are typed `T | undefined`; ServerBuild wants them absent-or-T.
const build = () => import("virtual:react-router/server-build") as unknown as Promise<ServerBuild>;
const requestHandler = createRequestHandler(build, import.meta.env.MODE);

export default {
  async fetch(request, env, ctx) {
    const webEnv = env as unknown as WebEnv;
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env: webEnv, ctx, services: servicesFor(webEnv) });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
