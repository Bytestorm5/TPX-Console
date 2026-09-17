import { ExternalLink, Plug, X } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";
import { CAPABILITIES, CreateConnectionInputSchema, type Capability } from "@tpx/contracts/connections";
import { hasGrant } from "@tpx/identity";
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, buttonClasses } from "@tpx/ui";
import type { Route } from "./+types/marketplace";
import { formValues, prefixed } from "~/lib/forms.ts";
import { cloudflareContext } from "~/shell/context.ts";
import { attempt, rpc } from "~/shell/rpc.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import { ActionNotice, ConfigInputs, CredentialInputs, ProviderIcon } from "../lib.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Marketplace · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.marketplace.read");
  const providers = await rpc(env.CONNECTIONS.listProviders());
  const wanted = new URL(args.request.url).searchParams.get("provider");
  const selected = providers.find((p) => p.id === wanted) ?? null;
  return {
    providers,
    selected,
    tenant: session.tenant,
    base: scopePath(session.project.slug, session.environment.name),
    canCreate: hasGrant(session.ctx, "tpx.connections.marketplace.create_connection"),
  };
}

export async function action(args: Route.ActionArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.marketplace.create_connection");
  const values = formValues(await args.request.formData());
  const capabilities = CAPABILITIES.filter((cap) => values[`cap:${cap}`] === "on");
  const parsed = CreateConnectionInputSchema.safeParse({
    provider: values.provider,
    name: values.name,
    ...(capabilities.length > 0 ? { capabilities } : {}),
    config: prefixed(values, "config"),
    credential: prefixed(values, "credential"),
  });
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  const result = await attempt(env.CONNECTIONS.createConnection(session.ctx, parsed.data));
  if (!result.ok) return result;
  throw redirect(scopePath(session.project.slug, session.environment.name, `connections/c/${result.value.id}`));
}

export default function Marketplace({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const { providers, selected, base, canCreate } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={loaderData.tenant.name}
        title="Marketplace"
        description="Providers the console knows how to talk to. Connecting one stores its credential encrypted in the connections service; nothing else ever reads it back."
      />
      {selected ? (
        <Card className="mb-8" data-testid="connect-form">
          <CardHeader
            title={`Connect ${selected.name}`}
            description={selected.description}
            actions={
              <Link to={`${base}/connections/marketplace`} className={buttonClasses("ghost", "sm")} aria-label="Cancel">
                <X size={14} /> Cancel
              </Link>
            }
          />
          {canCreate ? (
            <Form method="post" className="space-y-5" autoComplete="off">
              <input type="hidden" name="provider" value={selected.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="name" help="How this connection appears across the tenant.">
                  <Input id="name" name="name" required placeholder={`${selected.name} (production)`} />
                </Field>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium text-ink">Capabilities</legend>
                  <div className="flex flex-wrap gap-3">
                    {selected.capabilities.map((cap: Capability) => (
                      <label key={cap} className="flex items-center gap-2 text-sm text-ink">
                        <input type="checkbox" name={`cap:${cap}`} defaultChecked className="accent-accent" />
                        {cap}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              {selected.configFields.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Configuration</h3>
                  <ConfigInputs fields={selected.configFields} values={{}} prefix="config" />
                </div>
              ) : null}
              {selected.credentialFields.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Credential</h3>
                  <p className="mb-3 text-xs text-ink-muted">
                    Encrypted before it is stored. You can set per-environment values after connecting.
                  </p>
                  <CredentialInputs fields={selected.credentialFields} hints={{}} prefix="credential" creating />
                </div>
              ) : null}
              <ActionNotice result={actionData} />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={navigation.state !== "idle"} icon={<Plug size={16} />}>
                  Create connection
                </Button>
                {selected.docsUrl ? (
                  <a
                    href={selected.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    Provider docs <ExternalLink size={12} />
                  </a>
                ) : null}
              </div>
            </Form>
          ) : (
            <p className="text-sm text-ink-muted">
              You can browse the marketplace but connecting a provider needs a tenant-level grant.
            </p>
          )}
        </Card>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const active = selected?.id === provider.id;
          return (
            <Card
              key={provider.id}
              className={active ? "outline-2 outline-accent" : undefined}
              data-testid={`provider-${provider.id}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <ProviderIcon name={provider.icon} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold tracking-tight text-ink">{provider.name}</h2>
                  <p className="mt-1 text-sm text-ink-muted">{provider.description}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-1">
                {provider.capabilities.map((cap) => (
                  <Badge key={cap} tone="accent">
                    {cap}
                  </Badge>
                ))}
                {provider.testable ? <Badge tone="neutral">live test</Badge> : null}
              </div>
              <div className="mt-5 flex items-center justify-between">
                <Link
                  to={`${base}/connections/marketplace?provider=${provider.id}`}
                  className={buttonClasses(active ? "secondary" : "primary", "sm")}
                >
                  {active ? "Selected" : "Connect"}
                </Link>
                <span className="text-xs text-ink-muted">
                  {provider.credentialFields.filter((f) => f.secret).length} secret
                  {provider.credentialFields.filter((f) => f.secret).length === 1 ? "" : "s"}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
