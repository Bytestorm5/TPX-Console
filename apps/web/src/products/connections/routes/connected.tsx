import { Cable, Store } from "lucide-react";
import { Link } from "react-router";
import { hasGrant } from "@tpx/identity";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  buttonClasses,
} from "@tpx/ui";
import type { Route } from "./+types/connected";
import { cloudflareContext } from "~/shell/context.ts";
import { rpc } from "~/shell/rpc.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import { TestBadge, ProviderIcon } from "../lib.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Connections · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.connections.read");
  const [connections, providers, attachments] = await Promise.all([
    rpc(env.CONNECTIONS.listConnections(session.ctx)),
    rpc(env.CONNECTIONS.listProviders()),
    hasGrant(session.ctx, "tpx.connections.attachments.read")
      ? rpc(env.CONNECTIONS.listAttachments(session.ctx))
      : Promise.resolve([]),
  ]);
  const base = scopePath(session.project.slug, session.environment.name);
  return {
    base,
    tenant: session.tenant,
    project: session.project,
    canBrowse: hasGrant(session.ctx, "tpx.connections.marketplace.read"),
    rows: connections.map((c) => {
      const provider = providers.find((p) => p.id === c.provider);
      const secretKeys = provider?.credentialFields.filter((f) => f.secret).map((f) => f.key) ?? [];
      return {
        id: c.id,
        name: c.name,
        provider: c.provider,
        providerName: provider?.name ?? c.provider,
        icon: provider?.icon ?? "plug",
        capabilities: c.capabilities,
        secretsSet: secretKeys.filter((k) => c.credential[k]?.set).length,
        secretsTotal: secretKeys.length,
        environmentDefaults: Object.keys(c.environmentDefaults),
        lastTest: c.lastTest,
        attachedHere: attachments.filter((a) => a.connectionId === c.id).length,
      };
    }),
  };
}

export default function Connected({ loaderData }: Route.ComponentProps) {
  const { rows, base, canBrowse } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow={loaderData.tenant.name}
        title="Connected"
        description="Every provider this tenant has connected. Credentials are encrypted at rest and never leave the connections service; projects use them through attachments."
        actions={
          canBrowse ? (
            <Link to={`${base}/connections/marketplace`} className={buttonClasses("primary", "sm")}>
              <Store size={14} /> Browse marketplace
            </Link>
          ) : null
        }
      />
      <Card>
        <CardHeader title="Connections" description={`${rows.length} connected`} />
        {rows.length === 0 ? (
          <EmptyState
            icon={<Cable size={28} />}
            title="Nothing connected yet"
            description="Connect a provider from the marketplace, then attach it to a project."
            action={
              canBrowse ? (
                <Link to={`${base}/connections/marketplace`} className={buttonClasses("primary", "sm")}>
                  Open the marketplace
                </Link>
              ) : null
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Provider</TH>
                <TH>Capabilities</TH>
                <TH>Credential</TH>
                <TH>Defaults</TH>
                <TH>Status</TH>
                <TH>In {loaderData.project.name}</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => {
                return (
                  <TR key={row.id}>
                    <TD>
                      <Link to={`${base}/connections/c/${row.id}`} className="font-medium text-accent hover:underline">
                        {row.name}
                      </Link>
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <ProviderIcon name={row.icon} size={14} className="text-ink-muted" /> {row.providerName}
                      </span>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap gap-1">
                        {row.capabilities.map((cap) => (
                          <Badge key={cap}>{cap}</Badge>
                        ))}
                      </span>
                    </TD>
                    <TD className="text-ink-muted">
                      {row.secretsTotal === 0 ? "none needed" : `${row.secretsSet} / ${row.secretsTotal} set`}
                    </TD>
                    <TD className="text-ink-muted">
                      {row.environmentDefaults.length === 0 ? "—" : row.environmentDefaults.join(", ")}
                    </TD>
                    <TD>
                      <TestBadge lastTest={row.lastTest} />
                    </TD>
                    <TD className="text-ink-muted">
                      {row.attachedHere === 0 ? "not attached" : `${row.attachedHere} attached`}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
