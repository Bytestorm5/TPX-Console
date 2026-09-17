import { Form, useNavigation } from "react-router";
import { UpdateTenantEnvironmentsInputSchema } from "@tpx/contracts/auth";
import { hasGrant } from "@tpx/identity";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/environments";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt } from "../../shell/rpc.server.ts";
import { requireTenant } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";

export const meta: Route.MetaFunction = () => [{ title: "Environments · Trusplex Console" }];

export function loader(args: Route.LoaderArgs) {
  const session = requireTenant(args);
  return {
    tenant: session.tenant,
    canEdit: hasGrant(session.tenantCtx, "tpx.workspace.environments.update_vocabulary"),
  };
}

export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  const values = formValues(await args.request.formData());
  const split = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const parsed = UpdateTenantEnvironmentsInputSchema.safeParse({
    environments: split(values.environments),
    projectDefaults: split(values.projectDefaults),
  });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return attempt(env.AUTH.updateTenantEnvironments(session.tenantCtx, parsed.data));
}

export default function Environments({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { tenant } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Environments"
        description="Environments are tenant vocabulary, not per-project strings: connection defaults are keyed by these names, so `dev` and `develop` must never become two keys."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Vocabulary" description="The environment names projects may use." />
          <div className="flex flex-wrap gap-2" data-testid="vocabulary">
            {tenant.environments.map((e) => (
              <Badge key={e} tone={tenant.projectDefaults.includes(e) ? "accent" : "neutral"}>
                {e}
                {tenant.projectDefaults.includes(e) ? " · default" : ""}
              </Badge>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Change the vocabulary"
            description="A name still used by a project's environment cannot be removed."
          />
          {loaderData.canEdit ? (
            <Form method="post" className="space-y-4">
              <Field label="Environments" htmlFor="environments" help="Comma-separated, lowercase.">
                <Input id="environments" name="environments" defaultValue={tenant.environments.join(", ")} />
              </Field>
              <Field label="New projects get" htmlFor="projectDefaults" help="A subset of the vocabulary.">
                <Input id="projectDefaults" name="projectDefaults" defaultValue={tenant.projectDefaults.join(", ")} />
              </Field>
              {actionData && !actionData.ok ? <p className="text-sm text-danger">{actionData.error}</p> : null}
              {actionData?.ok ? <p className="text-sm text-success">Saved.</p> : null}
              <Button type="submit" disabled={navigation.state !== "idle"}>
                Save vocabulary
              </Button>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">Only tenant administrators can change the vocabulary.</p>
          )}
        </Card>
      </div>
    </>
  );
}
