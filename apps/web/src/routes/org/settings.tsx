import { Save } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { UpdateTenantInputSchema } from "@tpx/contracts/auth";
import { hasGrant } from "@tpx/identity";
import { Button, Card, CardHeader, Field, Input, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/settings";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt } from "../../shell/services.server.ts";
import { assertGrant, requireTenant } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";
import { formatWhen } from "../../lib/format.ts";

export const meta: Route.MetaFunction = () => [{ title: "Settings · Trusplex Console" }];

export function loader(args: Route.LoaderArgs) {
  const session = requireTenant(args);
  assertGrant(session.tenantCtx, "tpx.workspace.settings.read");
  return { tenant: session.tenant, canEdit: hasGrant(session.tenantCtx, "tpx.workspace.settings.update_settings") };
}

export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  assertGrant(session.tenantCtx, "tpx.workspace.settings.update_settings");
  const parsed = UpdateTenantInputSchema.safeParse(formValues(await args.request.formData()));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return attempt(services.auth.updateTenant(session.tenantCtx, parsed.data));
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { tenant, canEdit } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Settings"
        description="The organization itself. Members, access and environments have their own pages."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Name" />
          {canEdit ? (
            <Form method="post" className="space-y-4">
              <Field label="Organization name" htmlFor="name">
                <Input id="name" name="name" defaultValue={tenant.name} required maxLength={120} />
              </Field>
              {actionData && !actionData.ok ? <p className="text-sm text-danger">{actionData.error}</p> : null}
              {actionData?.ok ? <p className="text-sm text-success">Saved.</p> : null}
              <Button type="submit" disabled={navigation.state !== "idle"} icon={<Save size={16} />}>
                Save
              </Button>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">Only tenant administrators can rename the organization.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="About" />
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">Tenant id</dt>
              <dd className="font-mono text-ink">{tenant.id}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Created</dt>
              <dd className="text-ink">{formatWhen(tenant.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Environment vocabulary</dt>
              <dd className="text-ink">{tenant.environments.join(", ")}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
