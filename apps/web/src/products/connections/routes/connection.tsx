import { ExternalLink, FlaskConical, Link2, RotateCw, Trash } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import {
  CAPABILITIES,
  SetConnectionCredentialInputSchema,
  UpdateConnectionInputSchema,
  type Hints,
  type RevealedSecret,
  type SecretLocator,
  type Values,
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
  buttonClasses,
  cn,
} from "@tpx/ui";
import type { Route } from "./+types/connection";
import { formatWhen } from "~/lib/format.ts";
import { formValues, prefixed } from "~/lib/forms.ts";
import { cloudflareContext } from "~/shell/context.ts";
import { attempt, call } from "~/shell/services.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import {
  ActionNotice,
  ConfigInputs,
  CredentialInputs,
  RevealedSecretPanel,
  SecretRows,
  TestBadge,
  ProviderIcon,
} from "../lib.tsx";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.connection.name ?? "Connection"} · Trusplex Console` },
];

/** `""` is the connection base; anything else must be a name in the tenant's vocabulary. */
function levelParam(raw: string | null, vocabulary: readonly string[]): string {
  return raw && vocabulary.includes(raw) ? raw : "";
}

export async function loader(args: Route.LoaderArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.connections.read");
  const [connection, providers, attachments] = await Promise.all([
    call(services.connections.getConnection(session.ctx, args.params.connectionId)),
    call(services.connections.listProviders()),
    hasGrant(session.ctx, "tpx.connections.attachments.read")
      ? call(services.connections.listAttachments(session.ctx))
      : Promise.resolve([]),
  ]);
  const provider = providers.find((p) => p.id === connection.provider);
  if (!provider) throw data({ error: `provider ${connection.provider} is no longer available` }, { status: 404 });
  const level = levelParam(new URL(args.request.url).searchParams.get("level"), session.tenant.environments);
  const atLevel =
    level === ""
      ? { config: connection.config, credential: connection.credential }
      : (connection.environmentDefaults[level] ?? { config: {}, credential: {} });
  return {
    connection,
    provider,
    level,
    atLevel: atLevel as { config: Values; credential: Hints },
    vocabulary: session.tenant.environments,
    attachments: attachments.filter((a) => a.connectionId === connection.id),
    project: session.project,
    base: scopePath(session.project.slug, session.environment.name),
    can: {
      update: hasGrant(session.ctx, "tpx.connections.connections.update_connection"),
      rotate: hasGrant(session.ctx, "tpx.connections.connections.rotate_credential"),
      reveal: hasGrant(session.ctx, "tpx.connections.connections.reveal_secret"),
      test: hasGrant(session.ctx, "tpx.connections.connections.test_connection"),
      delete: hasGrant(session.ctx, "tpx.connections.connections.delete"),
      attach: hasGrant(session.ctx, "tpx.connections.attachments.attach_connection"),
    },
  };
}

type ActionResult =
  | { ok: true; message?: string; revealed?: RevealedSecret; test?: { ok: boolean; message: string; at: number } }
  | { ok: false; error: string; code?: string };

export async function action(args: Route.ActionArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  const id = args.params.connectionId;
  const values = formValues(await args.request.formData());
  const level = levelParam(values.level ?? null, session.tenant.environments);
  const environmentName = level === "" ? null : level;
  switch (values.intent) {
    case "settings": {
      assertGrant(session.ctx, "tpx.connections.connections.update_connection");
      const capabilities = CAPABILITIES.filter((cap) => values[`cap:${cap}`] === "on");
      const parsed = UpdateConnectionInputSchema.safeParse({
        name: values.name,
        ...(capabilities.length > 0 ? { capabilities } : {}),
      });
      if (!parsed.success)
        return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") } satisfies ActionResult;
      const result = await attempt(services.connections.updateConnection(session.ctx, id, parsed.data));
      return result.ok ? { ok: true, message: "Settings saved." } : result;
    }
    case "values": {
      // Config and credential at one level travel together; blank secrets are dropped (kept), blank config unsets.
      assertGrant(session.ctx, "tpx.connections.connections.rotate_credential");
      const parsed = SetConnectionCredentialInputSchema.safeParse({
        environmentName,
        values: prefixed(values, "credential"),
        config: prefixed(values, "config", true),
      });
      if (!parsed.success)
        return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      const result = await attempt(services.connections.setConnectionCredential(session.ctx, id, parsed.data));
      return result.ok ? { ok: true, message: `Values saved at ${environmentName ?? "the connection base"}.` } : result;
    }
    case "clear": {
      assertGrant(session.ctx, "tpx.connections.connections.rotate_credential");
      const key = values.key ?? "";
      const result = await attempt(
        services.connections.setConnectionCredential(session.ctx, id, { environmentName, values: { [key]: "" } }),
      );
      return result.ok ? { ok: true, message: `Cleared ${key}.` } : result;
    }
    case "reveal": {
      assertGrant(session.ctx, "tpx.connections.connections.reveal_secret");
      const locator: SecretLocator =
        environmentName === null
          ? { level: "connection-base", connectionId: id }
          : { level: "connection-environment", connectionId: id, environmentName };
      const result = await attempt(services.connections.revealSecret(session.ctx, locator, values.key ?? ""));
      if (!result.ok) return result;
      return data<ActionResult>({ ok: true, revealed: result.value }, { headers: { "Cache-Control": "no-store" } });
    }
    case "test": {
      assertGrant(session.ctx, "tpx.connections.connections.test_connection");
      const result = await attempt(services.connections.testConnection(session.ctx, id, environmentName));
      return result.ok ? { ok: true, test: result.value } : result;
    }
    case "delete": {
      assertGrant(session.ctx, "tpx.connections.connections.delete");
      const connection = await call(services.connections.getConnection(session.ctx, id));
      if (values.confirm !== connection.name)
        return { ok: false, error: "Type the connection's name to confirm deletion." };
      const result = await attempt(services.connections.deleteConnection(session.ctx, id));
      if (!result.ok) return result;
      throw redirect(scopePath(session.project.slug, session.environment.name, "connections"));
    }
    default:
      return { ok: false, error: "Unknown action." };
  }
}

export default function ConnectionDetail({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { connection, provider, level, atLevel, vocabulary, attachments, base, can } = loaderData;
  const levels = ["", ...vocabulary];
  const result = actionData as ActionResult | undefined;
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <ProviderIcon name={provider.icon} size={14} /> {provider.name}
          </span>
        }
        title={connection.name}
        description={provider.description}
        actions={
          <>
            <TestBadge lastTest={connection.lastTest} />
            {provider.docsUrl ? (
              <a href={provider.docsUrl} target="_blank" rel="noreferrer" className={buttonClasses("ghost", "sm")}>
                Docs <ExternalLink size={12} />
              </a>
            ) : null}
          </>
        }
      />

      {result?.ok && result.revealed ? (
        <div className="mb-6">
          <RevealedSecretPanel revealed={result.revealed} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <Card data-testid="values-card">
            <CardHeader
              title="Values"
              description="The base applies everywhere; a named default applies to every project environment with that name. Projects can still override both."
            />
            <div className="mb-5 flex flex-wrap gap-1 rounded-sm bg-surface p-1" role="tablist" aria-label="Level">
              {levels.map((name) => (
                <Link
                  key={name || "base"}
                  role="tab"
                  aria-selected={level === name}
                  to={
                    name === ""
                      ? `${base}/connections/c/${connection.id}`
                      : `${base}/connections/c/${connection.id}?level=${encodeURIComponent(name)}`
                  }
                  className={cn(
                    "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                    level === name
                      ? "bg-accent text-on-accent"
                      : "text-ink-muted hover:bg-surface-raised hover:text-ink",
                  )}
                >
                  {name === "" ? "Base" : name}
                  {name !== "" && connection.environmentDefaults[name] ? (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success align-middle" />
                  ) : null}
                </Link>
              ))}
            </div>

            {provider.credentialFields.some((f) => f.secret) ? (
              <div className="mb-5">
                <h4 className="mb-2 text-sm font-semibold text-ink">
                  Stored secrets · {level === "" ? "base" : level}
                </h4>
                <SecretRows
                  fields={provider.credentialFields}
                  hints={atLevel.credential}
                  canReveal={can.reveal}
                  canClear={can.rotate}
                  hidden={{ level }}
                />
              </div>
            ) : null}

            {can.rotate ? (
              <Form method="post" className="space-y-4" autoComplete="off">
                <input type="hidden" name="intent" value="values" />
                <input type="hidden" name="level" value={level} />
                {provider.configFields.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-ink">
                      Configuration · {level === "" ? "base" : level}
                    </h4>
                    <ConfigInputs fields={provider.configFields} values={atLevel.config} prefix="config" />
                  </div>
                ) : null}
                {provider.credentialFields.length > 0 ? (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-ink">
                      Rotate credential · {level === "" ? "base" : level}
                    </h4>
                    <CredentialInputs
                      fields={provider.credentialFields}
                      hints={atLevel.credential}
                      prefix="credential"
                    />
                  </div>
                ) : null}
                {result && !result.ok ? <ActionNotice result={result} /> : null}
                {result?.ok && result.message ? <ActionNotice result={result} /> : null}
                <Button type="submit" disabled={busy} icon={<RotateCw size={16} />}>
                  Save values
                </Button>
              </Form>
            ) : (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-ink">Configuration · {level === "" ? "base" : level}</h4>
                {provider.configFields.length === 0 ? (
                  <p className="text-sm text-ink-muted">This provider has no configuration.</p>
                ) : (
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {provider.configFields.map((f) => (
                      <div key={f.key} className="rounded-sm bg-surface px-3 py-2">
                        <dt className="text-xs text-ink-muted">{f.label}</dt>
                        <dd className="font-mono text-sm text-ink">{atLevel.config[f.key] || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-3 text-xs text-ink-muted">Rotating credentials needs a tenant-level grant.</p>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title={`Attached in ${loaderData.project.name}`}
              description="Attachments let a project use this connection; each one can override values per environment."
            />
            {attachments.length === 0 ? (
              <p className="text-sm text-ink-muted">Not attached to this project.</p>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Attachment</TH>
                    <TH>Capability</TH>
                    <TH>Default</TH>
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
                      <TD>
                        {a.isDefault ? (
                          <Badge tone="success">default</Badge>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            {can.attach ? (
              <div className="mt-4">
                <Link
                  to={`${base}/connections/attachments?connection=${connection.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  <Link2 size={14} /> Attach to this project
                </Link>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card data-testid="test-card">
            <CardHeader
              title="Test"
              description={
                provider.testable
                  ? "Runs a live call with the credential at the chosen level."
                  : "This provider has no live test; only the stored values are checked."
              }
            />
            {can.test ? (
              <Form method="post" className="flex items-end gap-3">
                <input type="hidden" name="intent" value="test" />
                <Field label="Level" htmlFor="test-level">
                  <Select id="test-level" name="level" defaultValue={level}>
                    <option value="">Base</option>
                    {vocabulary.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary" disabled={busy} icon={<FlaskConical size={16} />}>
                  Run test
                </Button>
              </Form>
            ) : (
              <p className="text-sm text-ink-muted">Testing needs a tenant-level grant.</p>
            )}
            {result?.ok && result.test ? (
              <p
                className={cn("mt-3 text-sm", result.test.ok ? "text-success" : "text-danger")}
                data-testid="test-result"
              >
                {result.test.ok ? "Passed" : "Failed"} · {result.test.message}
              </p>
            ) : connection.lastTest ? (
              <p className="mt-3 text-xs text-ink-muted">
                Last test {formatWhen(connection.lastTest.at)}: {connection.lastTest.message}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Settings" />
            {can.update ? (
              <Form method="post" className="space-y-4">
                <input type="hidden" name="intent" value="settings" />
                <Field label="Name" htmlFor="name">
                  <Input id="name" name="name" defaultValue={connection.name} required />
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink">Capabilities</legend>
                  <div className="flex flex-wrap gap-3">
                    {provider.capabilities.map((cap) => (
                      <label key={cap} className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          name={`cap:${cap}`}
                          defaultChecked={connection.capabilities.includes(cap)}
                          className="accent-accent"
                        />
                        {cap}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button type="submit" variant="secondary" disabled={busy}>
                  Save settings
                </Button>
              </Form>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-ink-muted">Capabilities</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {connection.capabilities.map((cap) => (
                      <Badge key={cap}>{cap}</Badge>
                    ))}
                  </dd>
                </div>
              </dl>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border-subtle pt-4 text-xs text-ink-muted">
              <div>
                <dt>Created</dt>
                <dd className="text-ink">{formatWhen(connection.createdAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd className="text-ink">{formatWhen(connection.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          {can.delete ? (
            <Card className="border-danger/40">
              <CardHeader
                title="Delete connection"
                description="Detaches it from every project and destroys every stored secret. This cannot be undone."
              />
              <Form method="post" className="flex items-end gap-3">
                <input type="hidden" name="intent" value="delete" />
                <Field label={`Type “${connection.name}” to confirm`} htmlFor="confirm">
                  <Input id="confirm" name="confirm" autoComplete="off" />
                </Field>
                <Button type="submit" variant="danger" disabled={busy} icon={<Trash size={16} />}>
                  Delete
                </Button>
              </Form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
