import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import { cloudflareContext } from "../src/shell/context.ts";
import type { WebEnv } from "../src/shell/env.ts";

// The virtual build's optional fields are typed `T | undefined`; ServerBuild wants them absent-or-T.
const build = () => import("virtual:react-router/server-build") as unknown as Promise<ServerBuild>;
const requestHandler = createRequestHandler(build, import.meta.env.MODE);

export default {
  async fetch(request, env, ctx) {
    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env: env as unknown as WebEnv, ctx });
    return requestHandler(request, context);
  },
} satisfies ExportedHandler<Env>;
