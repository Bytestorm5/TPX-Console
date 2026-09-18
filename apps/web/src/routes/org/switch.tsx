import { redirect } from "react-router";
import type { Route } from "./+types/switch";
import { cloudflareContext } from "../../shell/context.ts";
import { call } from "../../shell/services.server.ts";
import { clearScopeCookieHeader, resolveTenantSession, tenantCookieHeader } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";

/** Switches the active tenant: only to one the user is a member of, and the remembered scope is forgotten. */
export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = await resolveTenantSession(args);
  const { tenantId } = formValues(await args.request.formData());
  const wanted = session.tenants.find((t) => t.id === tenantId);
  if (!wanted) {
    const fresh = await call(services.auth.ensureUser({ userId: session.identity.userId }));
    if (!fresh.tenants.some((t) => t.id === tenantId)) return new Response("not a member", { status: 403 });
  }
  throw redirect("/", {
    headers: [
      ["Set-Cookie", tenantCookieHeader(tenantId ?? "")],
      ["Set-Cookie", clearScopeCookieHeader()],
    ],
  });
}

export function loader() {
  throw redirect("/");
}

export default function Switch() {
  return null;
}
