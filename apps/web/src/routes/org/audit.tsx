import { Card, CardHeader, EmptyState, PageHeader, TBody, TD, TH, THead, TR, Table } from "@tpx/ui";
import type { Route } from "./+types/audit";
import { cloudflareContext } from "../../shell/context.ts";
import { rpc } from "../../shell/rpc.server.ts";
import { requireTenant } from "../../shell/session.server.ts";
import { formatWhen } from "../../lib/format.ts";

export const meta: Route.MetaFunction = () => [{ title: "Audit · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  const session = requireTenant(args);
  return { tenant: session.tenant, entries: await rpc(env.AUTH.listAudit(session.tenantCtx, { limit: 200 })) };
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        eyebrow={loaderData.tenant.name}
        title="Audit"
        description="Every tenancy and access change, newest first."
      />
      <Card>
        <CardHeader title="Recent activity" />
        {loaderData.entries.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Target</TH>
              </tr>
            </THead>
            <TBody>
              {loaderData.entries.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-ink-muted">{formatWhen(e.at)}</TD>
                  <TD className="font-mono text-xs">{e.actor}</TD>
                  <TD>{e.action}</TD>
                  <TD className="font-mono text-xs text-ink-muted">{e.target}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
