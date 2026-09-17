import { ArrowRightLeft, Eraser, Save, Unplug } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import {
  SetBindingInputSchema,
  UpdateAttachmentInputSchema,
  type Binding,
  type PromotionPlan,
  type RevealedSecret,
  type SecretLocator,
} from "@tpx/contracts/connections";
import { hasGrant } from "@tpx/identity";
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
  cn,
} from "@tpx/ui";
import type { Route } from "./+types/attachment";
import { formatWhen, maskHint } from "~/lib/format.ts";
import { formValues, prefixed } from "~/lib/forms.ts";
import { cloudflareContext } from "~/shell/context.ts";
import { attempt, rpc } from "~/shell/rpc.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import {
  ActionNotice,
  ConfigInputs,
  CredentialInputs,
  LEVEL_LABELS,
  LevelBadge,
  RevealedSecretPanel,
  SecretRows,
} from "../lib.tsx";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.attachment.name ?? "Attachment"} · Trusplex Console` },
];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.attachments.read");
  const attachments = await rpc(env.CONNECTIONS.listAttachments(session.ctx));
  const attachment = attachments.find((a) => a.id === args.params.attachmentId);
  if (!attachment) throw data({ error: "attachment not found" }, { status: 404 });
  const canBindings = hasGrant(session.ctx, "tpx.connections.bindings.read");
  const [connection, providers, binding, resolution] = await Promise.all([
    hasGrant(session.ctx, "tpx.connections.connections.read")
      ? rpc(env.CONNECTIONS.getConnection(session.ctx, attachment.connectionId))
      : Promise.resolve(null),
    rpc(env.CONNECTIONS.listProviders()),
    canBindings ? rpc(env.CONNECTIONS.getBinding(session.ctx, attachment.id)) : Promise.resolve(null),
    hasGrant(session.ctx, "tpx.connections.usage.read")
      ? rpc(env.CONNECTIONS.resolve(session.ctx, attachment.capability, attachment.name))
      : Promise.resolve(null),
  ]);
  const providerId = connection?.provider ?? resolution?.attachment?.provider ?? null;
  const provider = providers.find((p) => p.id === providerId) ?? null;
  return {
    attachment,
    connection: connection ? { id: connection.id, name: connection.name, provider: connection.provider } : null,
    provider,
    binding,
    resolution,
    project: session.project,
    environment: session.environment,
    otherEnvironments: session.environments.filter((e) => e.id !== session.environment.id),
    base: scopePath(session.project.slug, session.environment.name),
    can: {
      update: hasGrant(session.ctx, "tpx.connections.attachments.update_attachment"),
      detach: hasGrant(session.ctx, "tpx.connections.attachments.detach_connection"),
      bindings: canBindings,
      updateBinding: hasGrant(session.ctx, "tpx.connections.bindings.update_binding"),
      clearBinding: hasGrant(session.ctx, "tpx.connections.bindings.clear_binding"),
      promote: hasGrant(session.ctx, "tpx.connections.bindings.promote_binding"),
      reveal: hasGrant(session.ctx, "tpx.connections.connections.reveal_secret"),
    },
  };
}

type ActionResult =
  | { ok: true; message?: string; revealed?: RevealedSecret; plan?: PromotionPlan; promoted?: Binding }
  | { ok: false; error: string; code?: string };

const fail = (error: string): ActionResult => ({ ok: false, error });
const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  const id = args.params.attachmentId;
  const values = formValues(await args.request.formData());
  switch (values.intent) {
    case "attachment": {
      assertGrant(session.ctx, "tpx.connections.attachments.update_attachment");
      const parsed = UpdateAttachmentInputSchema.safeParse({
        config: prefixed(values, "config", true),
        credential: prefixed(values, "credential"),
      });
      if (!parsed.success) return fail(issues(parsed.error));
      const result = await attempt(env.CONNECTIONS.updateAttachment(session.ctx, id, parsed.data));
      return result.ok ? ({ ok: true, message: "Project override saved." } satisfies ActionResult) : result;
    }
    case "settings": {
      assertGrant(session.ctx, "tpx.connections.attachments.update_attachment");
      const parsed = UpdateAttachmentInputSchema.safeParse({ name: values.name, isDefault: values.isDefault === "on" });
      if (!parsed.success) return fail(issues(parsed.error));
      const result = await attempt(env.CONNECTIONS.updateAttachment(session.ctx, id, parsed.data));
      if (!result.ok) return result;
      throw redirect(
        scopePath(session.project.slug, session.environment.name, `connections/attachments/${result.value.id}`),
      );
    }
    case "binding": {
      assertGrant(session.ctx, "tpx.connections.bindings.update_binding");
      const parsed = SetBindingInputSchema.safeParse({
        config: prefixed(values, "config", true),
        credential: prefixed(values, "credential"),
      });
      if (!parsed.success) return fail(issues(parsed.error));
      const result = await attempt(env.CONNECTIONS.setBinding(session.ctx, id, parsed.data));
      return result.ok
        ? ({ ok: true, message: `Override for ${session.environment.name} saved.` } satisfies ActionResult)
        : result;
    }
    case "clear": {
      // One secret key at one level. `level` is "attachment" or "binding".
      const key = values.key ?? "";
      if (values.level === "binding") {
        assertGrant(session.ctx, "tpx.connections.bindings.update_binding");
        const result = await attempt(env.CONNECTIONS.setBinding(session.ctx, id, { credential: { [key]: "" } }));
        return result.ok
          ? ({ ok: true, message: `Cleared ${key} for ${session.environment.name}.` } satisfies ActionResult)
          : result;
      }
      assertGrant(session.ctx, "tpx.connections.attachments.update_attachment");
      const result = await attempt(env.CONNECTIONS.updateAttachment(session.ctx, id, { credential: { [key]: "" } }));
      return result.ok ? ({ ok: true, message: `Cleared ${key} for the project.` } satisfies ActionResult) : result;
    }
    case "clear-binding": {
      assertGrant(session.ctx, "tpx.connections.bindings.clear_binding");
      const result = await attempt(env.CONNECTIONS.clearBinding(session.ctx, id));
      return result.ok
        ? ({ ok: true, message: `Every override for ${session.environment.name} cleared.` } satisfies ActionResult)
        : result;
    }
    case "reveal": {
      assertGrant(session.ctx, "tpx.connections.connections.reveal_secret");
      const locator: SecretLocator =
        values.level === "binding"
          ? { level: "binding", attachmentId: id, environmentId: session.ctx.environmentId }
          : { level: "attachment", attachmentId: id };
      const result = await attempt(env.CONNECTIONS.revealSecret(session.ctx, locator, values.key ?? ""));
      if (!result.ok) return result;
      return data<ActionResult>({ ok: true, revealed: result.value }, { headers: { "Cache-Control": "no-store" } });
    }
    case "plan": {
      assertGrant(session.ctx, "tpx.connections.bindings.promote_binding");
      const result = await attempt(env.CONNECTIONS.planPromotion(session.ctx, id, values.toEnvironmentId ?? ""));
      return result.ok ? ({ ok: true, plan: result.value } satisfies ActionResult) : result;
    }
    case "promote": {
      assertGrant(session.ctx, "tpx.connections.bindings.promote_binding");
      const result = await attempt(
        env.CONNECTIONS.promote(session.ctx, {
          attachmentId: id,
          toEnvironmentId: values.toEnvironmentId ?? "",
          digest: values.digest ?? "",
        }),
      );
      return result.ok ? ({ ok: true, promoted: result.value, message: "Promoted." } satisfies ActionResult) : result;
    }
    case "detach": {
      assertGrant(session.ctx, "tpx.connections.attachments.detach_connection");
      const result = await attempt(env.CONNECTIONS.detachConnection(session.ctx, id));
      if (!result.ok) return result;
      throw redirect(scopePath(session.project.slug, session.environment.name, "connections/attachments"));
    }
    default:
      return fail("Unknown action.");
  }
}

export default function AttachmentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { attachment, connection, provider, binding, resolution, environment, otherEnvironments, base, can } =
    loaderData;
  const result = actionData as ActionResult | undefined;
  const fields = provider ? [...provider.configFields, ...provider.credentialFields] : [];
  const configFields = provider?.configFields ?? [];
  const credentialFields = provider?.credentialFields ?? [];
  const targetName = (envId: string) => otherEnvironments.find((e) => e.id === envId)?.name ?? envId;
  return (
    <>
      <PageHeader
        eyebrow={
          <span>
            Attachments · {attachment.capability}
            {connection ? (
              <>
                {" "}
                · via{" "}
                <Link to={`${base}/connections/c/${connection.id}`} className="text-accent hover:underline">
                  {connection.name}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={attachment.name}
        description="Innermost wins: this environment's binding, then the project override, then the connection's default for an environment with this name, then its base."
        actions={
          attachment.isDefault ? (
            <Badge tone="success">default for {attachment.capability}</Badge>
          ) : (
            <Badge>named attachment</Badge>
          )
        }
      />

      {result?.ok && result.revealed ? (
        <div className="mb-6">
          <RevealedSecretPanel revealed={result.revealed} />
        </div>
      ) : null}
      {result && (!result.ok || result.message) ? (
        <div className="mb-4">
          <ActionNotice result={result} />
        </div>
      ) : null}

      {resolution ? (
        <Card className="mb-6" data-testid="resolved-card">
          <CardHeader
            title={`Resolved in ${environment.name}`}
            description={
              resolution.available
                ? "Every required value resolves."
                : `Missing: ${resolution.missing.join(", ")}. Products asking for this capability will be told it is unavailable.`
            }
            actions={
              resolution.available ? <Badge tone="success">available</Badge> : <Badge tone="danger">unavailable</Badge>
            }
          />
          <Table>
            <THead>
              <tr>
                <TH>Field</TH>
                <TH>Value</TH>
                <TH>Supplied by</TH>
              </tr>
            </THead>
            <TBody>
              {resolution.fields.map((f) => (
                <TR key={f.key} data-testid={`resolved-${f.key}`}>
                  <TD>
                    <span className="font-medium">{f.label}</span>
                    {f.required ? <span className="ml-1 text-xs text-ink-muted">required</span> : null}
                  </TD>
                  <TD className="font-mono text-xs">
                    {f.secret ? (f.set ? maskHint(f.hint) : "—") : (f.value ?? "—")}
                  </TD>
                  <TD>
                    <LevelBadge level={f.suppliedBy} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="project-override-card">
          <CardHeader
            title="Project override"
            description={`Applies to ${attachment.name} in every environment of this project.`}
          />
          {credentialFields.some((f) => f.secret) ? (
            <div className="mb-4">
              <SecretRows
                fields={credentialFields}
                hints={attachment.credential}
                canReveal={can.reveal}
                canClear={can.update}
                hidden={{ level: "attachment" }}
                override
              />
            </div>
          ) : null}
          {!provider ? (
            <p className="text-sm text-ink-muted">The provider descriptor is unavailable.</p>
          ) : can.update ? (
            <Form method="post" className="space-y-4" autoComplete="off">
              <input type="hidden" name="intent" value="attachment" />
              <ConfigInputs
                fields={configFields}
                values={attachment.config}
                prefix="config"
                idScope="attachment-config"
              />
              <CredentialInputs
                fields={credentialFields}
                hints={attachment.credential}
                prefix="credential"
                idScope="attachment-credential"
                override
              />
              {fields.length === 0 ? (
                <p className="text-sm text-ink-muted">This provider has nothing to override.</p>
              ) : null}
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || fields.length === 0}
                icon={<Save size={16} />}
              >
                Save project override
              </Button>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">You can view this attachment but not change its overrides.</p>
          )}
        </Card>

        <Card data-testid="binding-card">
          <CardHeader
            title={`Environment override · ${environment.name}`}
            description="Only this environment. Set here to differ from the project; clear to inherit again."
            actions={
              binding ? <Badge tone="accent">set {formatWhen(binding.updatedAt)}</Badge> : <Badge>inheriting</Badge>
            }
          />
          {!can.bindings ? (
            <p className="text-sm text-ink-muted">You cannot view bindings in this scope.</p>
          ) : (
            <>
              {credentialFields.some((f) => f.secret) ? (
                <div className="mb-4">
                  <SecretRows
                    fields={credentialFields}
                    hints={binding?.credential ?? {}}
                    canReveal={can.reveal}
                    canClear={can.updateBinding}
                    hidden={{ level: "binding" }}
                    override
                  />
                </div>
              ) : null}
              {!provider ? null : can.updateBinding ? (
                <Form method="post" className="space-y-4" autoComplete="off">
                  <input type="hidden" name="intent" value="binding" />
                  <ConfigInputs
                    fields={configFields}
                    values={binding?.config ?? {}}
                    prefix="config"
                    idScope="binding-config"
                  />
                  <CredentialInputs
                    fields={credentialFields}
                    hints={binding?.credential ?? {}}
                    prefix="credential"
                    idScope="binding-credential"
                    override
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={busy || fields.length === 0}
                      icon={<Save size={16} />}
                    >
                      Save environment override
                    </Button>
                  </div>
                </Form>
              ) : (
                <p className="text-sm text-ink-muted">You can view this binding but not change it.</p>
              )}
              {binding && can.clearBinding ? (
                <Form method="post" className="mt-3">
                  <input type="hidden" name="intent" value="clear-binding" />
                  <Button type="submit" variant="ghost" size="sm" disabled={busy} icon={<Eraser size={14} />}>
                    Clear every override for {environment.name}
                  </Button>
                </Form>
              ) : null}
            </>
          )}
        </Card>
      </div>

      {can.promote ? (
        <Card className="mt-6" data-testid="promotion-card">
          <CardHeader
            title="Promote to another environment"
            description={`Copy ${environment.name}'s resolved values for this attachment into another environment's override. You see the diff first; confirming echoes its digest, so a changed plan is refused.`}
          />
          {otherEnvironments.length === 0 ? (
            <p className="text-sm text-ink-muted">This project has only one environment.</p>
          ) : (
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="plan" />
              <Field label="Target environment" htmlFor="toEnvironmentId">
                <Select
                  id="toEnvironmentId"
                  name="toEnvironmentId"
                  defaultValue={result?.ok && result.plan ? result.plan.toEnvironmentId : otherEnvironments[0]?.id}
                >
                  {otherEnvironments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary" disabled={busy} icon={<ArrowRightLeft size={16} />}>
                Plan promotion
              </Button>
            </Form>
          )}
          {result?.ok && result.plan ? (
            <div className="mt-5" data-testid="promotion-plan">
              <h4 className="mb-2 text-sm font-semibold text-ink">
                {environment.name} → {targetName(result.plan.toEnvironmentId)}
              </h4>
              {result.plan.changes.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing to promote: the target already matches.</p>
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Key</TH>
                      <TH>{environment.name}</TH>
                      <TH>{targetName(result.plan.toEnvironmentId)}</TH>
                      <TH>Action</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {result.plan.changes.map((ch) => (
                      <TR key={ch.key}>
                        <TD className="font-medium">{ch.key}</TD>
                        <TD className="font-mono text-xs">
                          {ch.secret ? (ch.from.set ? maskHint(ch.from.hint) : "—") : (ch.from.value ?? "—")}
                        </TD>
                        <TD className="font-mono text-xs">
                          {ch.secret ? (ch.to.set ? maskHint(ch.to.hint) : "—") : (ch.to.value ?? "—")}
                        </TD>
                        <TD>
                          <Badge tone={ch.action === "copy" ? "accent" : ch.action === "clear" ? "danger" : "neutral"}>
                            {ch.action}
                          </Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {result.plan.changes.some((ch) => ch.action !== "unchanged") ? (
                <Form method="post" className="mt-4">
                  <input type="hidden" name="intent" value="promote" />
                  <input type="hidden" name="toEnvironmentId" value={result.plan.toEnvironmentId} />
                  <input type="hidden" name="digest" value={result.plan.digest} />
                  <Button type="submit" disabled={busy} icon={<ArrowRightLeft size={16} />}>
                    Confirm promotion to {targetName(result.plan.toEnvironmentId)}
                  </Button>
                </Form>
              ) : null}
            </div>
          ) : null}
          {result?.ok && result.promoted ? (
            <p className="mt-4 text-sm text-success" data-testid="promotion-done">
              Promoted into {targetName(result.promoted.environmentId)} ({Object.keys(result.promoted.config).length}{" "}
              config, {Object.keys(result.promoted.credential).length} secret
              {Object.keys(result.promoted.credential).length === 1 ? "" : "s"}) — {LEVEL_LABELS.binding}.
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Settings" />
          {can.update ? (
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="settings" />
              <Field
                label="Name"
                htmlFor="name"
                help="Products ask for this capability by name when they need something other than the default."
              >
                <Input id="name" name="name" defaultValue={attachment.name} pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
              </Field>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="isDefault"
                  defaultChecked={attachment.isDefault}
                  className="accent-accent"
                />
                Default for {attachment.capability} in this project
              </label>
              <Button type="submit" variant="secondary" disabled={busy}>
                Save settings
              </Button>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">Created {formatWhen(attachment.createdAt)}.</p>
          )}
        </Card>
        {can.detach ? (
          <Card className={cn("border-danger/40")}>
            <CardHeader
              title="Detach"
              description="Removes this attachment, its project override and every environment binding. The tenant connection is untouched."
            />
            <Form
              method="post"
              onSubmit={(e) => (window.confirm(`Detach ${attachment.name}?`) ? undefined : e.preventDefault())}
            >
              <input type="hidden" name="intent" value="detach" />
              <Button type="submit" variant="danger" disabled={busy} icon={<Unplug size={16} />}>
                Detach from {loaderData.project.name}
              </Button>
            </Form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
