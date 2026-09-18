import { Archive, FolderPlus } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import { CreateProjectInputSchema } from "@tpx/contracts/auth";
import { hasGrant } from "@tpx/identity";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@tpx/ui";
import type { Route } from "./+types/projects";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt, call } from "../../shell/services.server.ts";
import { requireTenant } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";

export const meta: Route.MetaFunction = () => [{ title: "Projects · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  const projects = await call(services.auth.listProjects(session.tenantCtx));
  return {
    projects,
    tenant: session.tenant,
    canCreate: hasGrant(session.tenantCtx, "tpx.workspace.projects.create_project"),
  };
}

export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  const values = formValues(await args.request.formData());
  const parsed = CreateProjectInputSchema.safeParse({
    name: values.name,
    ...(values.slug ? { slug: values.slug } : {}),
    environments: session.tenant.environments.filter((e) => values[`env:${e}`] === "on"),
  });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return attempt(services.auth.createProject(session.tenantCtx, parsed.data));
}

export default function Projects({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { projects, tenant } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Projects"
        description="A project is a unit of delivered work — a client site, an app. Every project is created with the tenant's default environments."
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="All projects" />
          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderPlus size={28} />}
              title="No projects yet"
              description="Create your first project to start attaching connections."
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Slug</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {projects.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link to={`/${p.slug}`} className="font-medium text-accent hover:underline">
                        {p.name}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs text-ink-muted">{p.slug}</TD>
                    <TD>
                      {p.archivedAt ? <Badge tone="neutral">archived</Badge> : <Badge tone="success">active</Badge>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        {loaderData.canCreate ? (
          <Card>
            <CardHeader title="New project" />
            <Form method="post" className="space-y-4">
              <Field label="Name" htmlFor="name">
                <Input id="name" name="name" required placeholder="Client site" />
              </Field>
              <Field label="Slug" htmlFor="slug" help="Optional; derived from the name.">
                <Input id="slug" name="slug" placeholder="client-site" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
              </Field>
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-ink">Environments</legend>
                <div className="flex flex-wrap gap-3">
                  {tenant.environments.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        name={`env:${name}`}
                        defaultChecked={tenant.projectDefaults.includes(name)}
                        className="accent-accent"
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
              {actionData && !actionData.ok ? <p className="text-sm text-danger">{actionData.error}</p> : null}
              {actionData?.ok ? <p className="text-sm text-success">Created {actionData.value.name}.</p> : null}
              <Button type="submit" disabled={navigation.state !== "idle"} icon={<FolderPlus size={16} />}>
                Create project
              </Button>
            </Form>
          </Card>
        ) : (
          <Card>
            <CardHeader title="New project" />
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Archive size={16} /> You can view projects but not create them.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
