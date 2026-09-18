import { Building, Plus } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { CreateTenantInputSchema } from "@tpx/contracts/auth";
import { Button, Field, Input, buttonClasses } from "@tpx/ui";
import type { Route } from "./+types/new";
import { AuthPanel } from "../../shell/components/AuthPanel.tsx";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt } from "../../shell/rpc.server.ts";
import { clearScopeCookieHeader, resolveTenantSession, tenantCookieHeader } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";

export const meta: Route.MetaFunction = () => [{ title: "New organization · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const session = await resolveTenantSession(args);
  return { count: session.tenants.length };
}

/** Any signed-in user may create another tenant; they become its owner and land in it. */
export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = await resolveTenantSession(args);
  const parsed = CreateTenantInputSchema.safeParse(formValues(await args.request.formData()));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const result = await attempt(
    env.AUTH.createTenant({ name: parsed.data.name, creatorUserId: session.identity.userId }),
  );
  if (!result.ok) return result;
  throw redirect("/", {
    headers: [
      ["Set-Cookie", tenantCookieHeader(result.value.id)],
      ["Set-Cookie", clearScopeCookieHeader()],
    ],
  });
}

export default function NewTenant({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return (
    <AuthPanel>
      <div className="rounded-md border border-border-subtle bg-surface-raised p-8">
        <div className="mb-4 flex items-center gap-2 text-accent">
          <Building size={20} />
          <h2 className="text-xl font-bold tracking-tight text-ink">New organization</h2>
        </div>
        <p className="text-sm text-ink-muted">
          An organization is a tenant: its own projects, environments, connections and members. You will be its owner.
          {loaderData.count > 0 ? ` You belong to ${loaderData.count} already.` : ""}
        </p>
        <Form method="post" className="mt-6 space-y-4">
          <Field label="Name" htmlFor="name">
            <Input id="name" name="name" required autoFocus placeholder="Acme" maxLength={120} />
          </Field>
          {actionData && !actionData.ok ? <p className="text-sm text-danger">{actionData.error}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={navigation.state !== "idle"} icon={<Plus size={16} />}>
              Create organization
            </Button>
            <Link to="/" className={buttonClasses("ghost")}>
              Cancel
            </Link>
          </div>
        </Form>
      </div>
    </AuthPanel>
  );
}
