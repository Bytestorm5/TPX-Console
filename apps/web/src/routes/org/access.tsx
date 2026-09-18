import { KeyRound, Trash } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { CreateGrantInputSchema } from "@tpx/contracts/auth";
import { environmentScope, hasGrant, parseTpxScope, projectScope, tenantScope } from "@tpx/identity";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@tpx/ui";
import type { Route } from "./+types/access";
import { cloudflareContext } from "../../shell/context.ts";
import { attempt, call } from "../../shell/services.server.ts";
import { requireTenant } from "../../shell/session.server.ts";
import { formValues } from "../../lib/forms.ts";

export const meta: Route.MetaFunction = () => [{ title: "Access · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  const [grants, roles, projects] = await Promise.all([
    call(services.auth.listGrants(session.tenantCtx)),
    call(services.auth.listRoles()),
    call(services.auth.listProjects(session.tenantCtx)),
  ]);
  const environments = (
    await Promise.all(
      projects.map((p) =>
        call(services.auth.resolveScope({ tenantId: session.tenant.id, projectSlug: p.slug, environmentName: null })),
      ),
    )
  ).flatMap((r) => (r ? r.environments.map((e) => ({ ...e, projectSlug: r.project.slug })) : []));
  return {
    grants,
    roles,
    projects,
    environments,
    tenant: session.tenant,
    canManage: hasGrant(session.tenantCtx, "tpx.workspace.access.manage_grants"),
  };
}

export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  const values = formValues(await args.request.formData());
  if (values.intent === "delete" && values.grantId)
    return attempt(services.auth.deleteGrant(session.tenantCtx, values.grantId));
  const parsed = CreateGrantInputSchema.safeParse({
    subject: values.subject,
    roleId: values.roleId,
    scope: values.scope,
  });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return attempt(services.auth.createGrant(session.tenantCtx, parsed.data));
}

function describeScope(
  scope: string,
  projects: { id: string; name: string }[],
  environments: { id: string; name: string; projectSlug: string }[],
): string {
  const parsed = parseTpxScope(scope);
  if (!parsed) return scope;
  switch (parsed.level) {
    case "global":
      return "everywhere";
    case "tenant":
      return "whole tenant";
    case "project":
      return `project ${projects.find((p) => p.id === parsed.projectId)?.name ?? parsed.projectId}`;
    case "environment": {
      const e = environments.find((x) => x.id === parsed.environmentId);
      return e ? `${e.projectSlug} / ${e.name}` : parsed.environmentId;
    }
  }
}

export default function Access({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { grants, roles, projects, environments, tenant } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={tenant.name}
        title="Access"
        description="Who holds which role, and where. A grant at the tenant covers every project; a grant at a project or environment stays there. Revocation is immediate."
      />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Grants" />
          <Table>
            <THead>
              <tr>
                <TH>Subject</TH>
                <TH>Role</TH>
                <TH>Scope</TH>
                <TH>Source</TH>
                {loaderData.canManage ? <TH /> : null}
              </tr>
            </THead>
            <TBody>
              {grants.map((g) => {
                const provenance = g.provenance as { kind?: string; source?: string } | undefined;
                return (
                  <TR key={g.id}>
                    <TD className="font-mono text-xs">{g.subject}</TD>
                    <TD>
                      {g.roleId ? (
                        <Badge tone="accent">{roles.find((r) => r.id === g.roleId)?.name ?? g.roleId}</Badge>
                      ) : (
                        <code className="text-xs">{g.pattern}</code>
                      )}
                    </TD>
                    <TD className="text-ink-muted">{describeScope(g.scope, projects, environments)}</TD>
                    <TD className="text-xs text-ink-muted">
                      {provenance?.kind === "import" ? provenance.source : (provenance?.kind ?? "")}
                    </TD>
                    {loaderData.canManage ? (
                      <TD className="text-right">
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="grantId" value={g.id} />
                          <Button
                            variant="ghost"
                            size="sm"
                            type="submit"
                            aria-label="Delete grant"
                            icon={<Trash size={14} />}
                          />
                        </Form>
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
        {loaderData.canManage ? (
          <Card>
            <CardHeader title="Grant a role" />
            <Form method="post" className="space-y-4">
              <Field label="Subject" htmlFor="subject" help={`user:<clerk user id> or org:${tenant.id}`}>
                <Input id="subject" name="subject" placeholder="user:user_2abc…" required />
              </Field>
              <Field label="Role" htmlFor="roleId">
                <Select id="roleId" name="roleId" defaultValue="tpx-member">
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {r.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Scope" htmlFor="scope">
                <Select id="scope" name="scope" defaultValue={tenantScope(tenant.id)}>
                  <option value={tenantScope(tenant.id)}>Whole tenant</option>
                  {projects.map((p) => (
                    <option key={p.id} value={projectScope(p.id)}>
                      Project · {p.name}
                    </option>
                  ))}
                  {environments.map((e) => (
                    <option key={e.id} value={environmentScope(e.id)}>
                      Environment · {e.projectSlug} / {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {actionData && !actionData.ok ? <p className="text-sm text-danger">{actionData.error}</p> : null}
              <Button type="submit" disabled={navigation.state !== "idle"} icon={<KeyRound size={16} />}>
                Grant
              </Button>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
