import { redirect } from "react-router";
import type { Route } from "./+types/project";
import { resolveScopeSession } from "../shell/session.server.ts";
import { scopePath } from "../shell/scope.ts";

/** The two-segment form `/<project>` redirects to the project's default environment. */
export async function loader(args: Route.LoaderArgs) {
  const session = await resolveScopeSession(args, args.params.project, null);
  throw redirect(scopePath(session.project.slug, session.environment.name));
}

export default function Project() {
  return null;
}
