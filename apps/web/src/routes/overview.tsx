import { ArrowRight, Plug, Plus } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { AddEnvironmentInputSchema } from "@tpx/contracts/auth";
import { CAPABILITIES } from "@tpx/contracts/connections";
import { hasGrant } from "@tpx/identity";
import { Badge, Button, Card, CardHeader, Field, PageHeader, Select, Stat, buttonClasses } from "@tpx/ui";
import type { Route } from "./+types/overview";
import { formValues } from "../lib/forms.ts";
import { cloudflareContext } from "../shell/context.ts";
import { attempt } from "../shell/services.server.ts";
import { requireScope } from "../shell/session.server.ts";
import { scopePath } from "../shell/scope.ts";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.project.name ?? "Overview"} · Trusplex Console` },
];

export async function loader(args: Route.LoaderArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  const canSee = hasGrant(session.ctx, "tpx.connections.usage.read");
  const resolutions = canSee
    ? await Promise.all(
        CAPABILITIES.map((capability) => services.connections.resolve(session.ctx, capability).catch(() => null)),
      )
    : [];
  return {
    project: session.project,
    environment: session.environment,
    environments: session.environments,
    tenant: session.tenant,
    grants: session.ctx.grants.length,
    capabilities: resolutions.filter((r): r is NonNullable<typeof r> => r !== null),
    canAddEnvironment: hasGrant(session.ctx, "tpx.workspace.environments.add_environment"),
    canExtendVocabulary: hasGrant(session.tenantCtx, "tpx.workspace.environments.update_vocabulary"),
  };
}

/** Adds an environment from the tenant vocabulary to this project (extending the vocabulary is a separate, tenant-level grant). */
export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  const values = formValues(await args.request.formData());
  const name = values.name === "__new" ? values.newName : values.name;
  const parsed = AddEnvironmentInputSchema.safeParse({ name, extendVocabulary: values.name === "__new" });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  const result = await attempt(services.auth.addEnvironment(session.ctx, parsed.data));
  if (!result.ok) return result;
  throw redirect(scopePath(session.project.slug, result.value.name));
}

export default function Overview({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { project, environment, environments, capabilities, tenant } = loaderData;
  const base = scopePath(project.slug, environment.name);
  const available = capabilities.filter((c) => c.available);
  const unused = tenant.environments.filter((name) => !environments.some((e) => e.name === name));
  return (
    <>
      <PageHeader
        eyebrow={`${loaderData.tenant.name} · ${environment.name}`}
        title={project.name}
        description="Everything this project can reach in this environment. Connections are configured once at the tenant and resolved here."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Environments" value={environments.length} hint={environments.map((e) => e.name).join(", ")} />
        <Stat
          label="Capabilities available"
          value={`${available.length} / ${capabilities.length}`}
          hint="resolved for this environment"
        />
        <Stat label="Your grants here" value={loaderData.grants} hint="permission keys at this scope" />
      </div>
      {loaderData.canAddEnvironment ? (
        <Card className="mt-6" data-testid="environments-card">
          <CardHeader
            title="Environments"
            description={`${project.name} has ${environments.map((e) => e.name).join(", ")}. Names come from the tenant vocabulary.`}
          />
          <Form method="post" className="flex flex-wrap items-end gap-3">
            <Field label="Add environment" htmlFor="env-name">
              <Select id="env-name" name="name" defaultValue={unused[0] ?? "__new"}>
                {unused.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {loaderData.canExtendVocabulary ? (
                  <option value="__new">New name (extends the vocabulary)…</option>
                ) : null}
              </Select>
            </Field>
            {loaderData.canExtendVocabulary ? (
              <Field label="New name" htmlFor="env-new-name">
                <input
                  id="env-new-name"
                  name="newName"
                  placeholder="staging"
                  pattern="[a-z][a-z0-9-]*"
                  className="h-10 w-40 rounded-sm border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-2 focus:outline-offset-1 focus:outline-focus"
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              variant="secondary"
              disabled={navigation.state !== "idle" || (unused.length === 0 && !loaderData.canExtendVocabulary)}
              icon={<Plus size={16} />}
            >
              Add
            </Button>
            {actionData && !actionData.ok ? <p className="basis-full text-sm text-danger">{actionData.error}</p> : null}
          </Form>
        </Card>
      ) : null}
      <Card className="mt-6">
        <CardHeader
          title="Connections"
          description="Which capabilities resolve in this environment, and which level supplied them."
          actions={
            <Link to={`${base}/connections/attachments`} className={buttonClasses("secondary", "sm")}>
              Manage attachments <ArrowRight size={14} />
            </Link>
          }
        />
        {capabilities.length === 0 ? (
          <p className="text-sm text-ink-muted">You cannot see connection usage in this scope.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {capabilities.map((c) => (
              <li key={c.capability} className="flex items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <Plug size={16} className="text-ink-muted" />
                  <span className="font-medium text-ink">{c.capability}</span>
                  {c.attachment ? (
                    <span className="text-sm text-ink-muted">via {c.attachment.connectionName}</span>
                  ) : null}
                </div>
                {c.available ? (
                  <Badge tone="success">available</Badge>
                ) : c.attachment ? (
                  <Badge tone="warning">missing {c.missing.join(", ")}</Badge>
                ) : (
                  <Badge tone="neutral">not attached</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
