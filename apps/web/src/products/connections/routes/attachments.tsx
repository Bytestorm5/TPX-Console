import { Link2, Plug, Star, Unplug } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { AttachConnectionInputSchema, CAPABILITIES, type Resolution } from "@tpx/contracts/connections";
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
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  buttonClasses,
} from "@tpx/ui";
import type { Route } from "./+types/attachments";
import { formValues } from "~/lib/forms.ts";
import { cloudflareContext } from "~/shell/context.ts";
import { attempt, rpc } from "~/shell/rpc.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import { ActionNotice } from "../lib.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Attachments · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.attachments.read");
  const canSeeConnections = hasGrant(session.ctx, "tpx.connections.connections.read");
  const canSeeUsage = hasGrant(session.ctx, "tpx.connections.usage.read");
  const [attachments, connections, resolutions] = await Promise.all([
    rpc(env.CONNECTIONS.listAttachments(session.ctx)),
    canSeeConnections ? rpc(env.CONNECTIONS.listConnections(session.ctx)) : Promise.resolve([]),
    canSeeUsage
      ? Promise.all(
          CAPABILITIES.map((capability) =>
            env.CONNECTIONS.resolve(session.ctx, capability).catch((): Resolution | null => null),
          ),
        )
      : Promise.resolve([] as (Resolution | null)[]),
  ]);
  const preselect = new URL(args.request.url).searchParams.get("connection");
  return {
    project: session.project,
    environment: session.environment,
    base: scopePath(session.project.slug, session.environment.name),
    attachments: attachments.map((a) => ({
      ...a,
      connectionName: connections.find((c) => c.id === a.connectionId)?.name ?? a.connectionId,
    })),
    connections: connections.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      capabilities: c.capabilities,
    })),
    resolutions: resolutions.filter((r): r is Resolution => r !== null),
    preselect: connections.some((c) => c.id === preselect) ? preselect : null,
    can: {
      attach: hasGrant(session.ctx, "tpx.connections.attachments.attach_connection"),
      update: hasGrant(session.ctx, "tpx.connections.attachments.update_attachment"),
      detach: hasGrant(session.ctx, "tpx.connections.attachments.detach_connection"),
    },
  };
}

export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  const values = formValues(await args.request.formData());
  switch (values.intent) {
    case "attach": {
      assertGrant(session.ctx, "tpx.connections.attachments.attach_connection");
      const [connectionId, capability] = (values.target ?? "").split(":");
      const parsed = AttachConnectionInputSchema.safeParse({
        connectionId,
        capability,
        ...(values.name ? { name: values.name } : {}),
        isDefault: values.isDefault === "on",
      });
      if (!parsed.success)
        return {
          ok: false as const,
          error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        };
      const result = await attempt(env.CONNECTIONS.attachConnection(session.ctx, parsed.data));
      if (!result.ok) return result;
      throw redirect(
        scopePath(session.project.slug, session.environment.name, `connections/attachments/${result.value.id}`),
      );
    }
    case "default": {
      assertGrant(session.ctx, "tpx.connections.attachments.update_attachment");
      const result = await attempt(
        env.CONNECTIONS.updateAttachment(session.ctx, values.attachmentId ?? "", { isDefault: true }),
      );
      return result.ok
        ? { ok: true as const, message: `${result.value.name} is now the default for ${result.value.capability}.` }
        : result;
    }
    case "detach": {
      assertGrant(session.ctx, "tpx.connections.attachments.detach_connection");
      const result = await attempt(env.CONNECTIONS.detachConnection(session.ctx, values.attachmentId ?? ""));
      return result.ok ? { ok: true as const, message: "Detached." } : result;
    }
    default:
      return { ok: false as const, error: "Unknown action." };
  }
}

function suppliedSummary(resolution: Resolution): string {
  const overridden = resolution.fields.filter(
    (f) => f.suppliedBy === "binding" || f.suppliedBy === "attachment",
  ).length;
  const inherited = resolution.fields.filter(
    (f) => f.suppliedBy === "connection-environment" || f.suppliedBy === "connection-base",
  ).length;
  return `${overridden} overridden · ${inherited} inherited`;
}

export default function Attachments({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { attachments, connections, resolutions, base, can, environment, project, preselect } = loaderData;
  const targets = connections.flatMap((c) =>
    c.capabilities.map((cap) => ({ value: `${c.id}:${cap}`, label: `${c.name} — ${cap}`, connectionId: c.id })),
  );
  return (
    <>
      <PageHeader
        eyebrow={`${project.name} · ${environment.name}`}
        title="Attachments"
        description="A project uses a tenant connection through an attachment. Each attachment can carry project-wide overrides and per-environment bindings; products resolve a capability, never a connection."
      />
      {actionData ? (
        <div className="mb-4">
          <ActionNotice result={actionData} />
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          {resolutions.length > 0 ? (
            <Card data-testid="resolution-card">
              <CardHeader
                title={`Resolved in ${environment.name}`}
                description="What each capability resolves to right now, and how much of it this project overrides."
              />
              <Table>
                <THead>
                  <tr>
                    <TH>Capability</TH>
                    <TH>Via</TH>
                    <TH>Status</TH>
                    <TH>Supplied by</TH>
                  </tr>
                </THead>
                <TBody>
                  {resolutions.map((r) => (
                    <TR key={r.capability}>
                      <TD className="font-medium">{r.capability}</TD>
                      <TD className="text-ink-muted">
                        {r.attachment ? (
                          <Link
                            to={`${base}/connections/attachments/${r.attachment.id}`}
                            className="text-accent hover:underline"
                          >
                            {r.attachment.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {r.attachment ? <span className="ml-1">({r.attachment.connectionName})</span> : null}
                      </TD>
                      <TD>
                        {r.available ? (
                          <Badge tone="success">available</Badge>
                        ) : r.attachment ? (
                          <Badge tone="warning">missing {r.missing.join(", ")}</Badge>
                        ) : (
                          <Badge tone="neutral">not attached</Badge>
                        )}
                      </TD>
                      <TD className="text-xs text-ink-muted">{r.attachment ? suppliedSummary(r) : "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title={`All attachments in ${project.name}`}
              description="One default per capability; the others are reachable by name."
            />
            {attachments.length === 0 ? (
              <EmptyState
                icon={<Link2 size={28} />}
                title="No attachments yet"
                description="Attach a tenant connection so this project can use it."
              />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Capability</TH>
                    <TH>Connection</TH>
                    <TH>Default</TH>
                    <TH className="text-right">Actions</TH>
                  </tr>
                </THead>
                <TBody>
                  {attachments.map((a) => (
                    <TR key={a.id}>
                      <TD>
                        <Link
                          to={`${base}/connections/attachments/${a.id}`}
                          className="font-medium text-accent hover:underline"
                        >
                          {a.name}
                        </Link>
                      </TD>
                      <TD>
                        <Badge>{a.capability}</Badge>
                      </TD>
                      <TD className="text-ink-muted">{a.connectionName}</TD>
                      <TD>
                        {a.isDefault ? (
                          <Badge tone="success">default</Badge>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <span className="inline-flex items-center gap-2">
                          {!a.isDefault && can.update ? (
                            <Form method="post">
                              <input type="hidden" name="intent" value="default" />
                              <input type="hidden" name="attachmentId" value={a.id} />
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                icon={<Star size={14} />}
                              >
                                Make default
                              </Button>
                            </Form>
                          ) : null}
                          {can.detach ? (
                            <Form
                              method="post"
                              onSubmit={(e) =>
                                window.confirm(`Detach ${a.name}? Its overrides and bindings are deleted.`)
                                  ? undefined
                                  : e.preventDefault()
                              }
                            >
                              <input type="hidden" name="intent" value="detach" />
                              <input type="hidden" name="attachmentId" value={a.id} />
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                icon={<Unplug size={14} />}
                                className="text-danger"
                              >
                                Detach
                              </Button>
                            </Form>
                          ) : null}
                        </span>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div>
          <Card data-testid="attach-card">
            <CardHeader
              title="Attach a connection"
              description="Pick a tenant connection and the capability this project will use it for."
            />
            {!can.attach ? (
              <p className="text-sm text-ink-muted">You can view attachments but not create them here.</p>
            ) : targets.length === 0 ? (
              <EmptyState
                icon={<Plug size={24} />}
                title="Nothing to attach"
                description="Connect a provider first."
                action={
                  <Link to={`${base}/connections/marketplace`} className={buttonClasses("primary", "sm")}>
                    Open the marketplace
                  </Link>
                }
              />
            ) : (
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="attach" />
                <Field label="Connection and capability" htmlFor="target">
                  <Select
                    id="target"
                    name="target"
                    defaultValue={targets.find((t) => t.connectionId === preselect)?.value ?? targets[0]?.value}
                    required
                  >
                    {targets.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Name"
                  htmlFor="attach-name"
                  help="Optional. Defaults to the capability name; use a name to attach two of the same kind."
                >
                  <Input id="attach-name" name="name" placeholder="assets-bucket" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                </Field>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="isDefault" defaultChecked className="accent-accent" />
                  Make it the default for its capability
                </label>
                <Button type="submit" disabled={busy} icon={<Link2 size={16} />}>
                  Attach
                </Button>
              </Form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
