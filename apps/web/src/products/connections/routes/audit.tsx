import { ScrollText } from "lucide-react";
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
  cn,
  type BadgeTone,
} from "@tpx/ui";
import type { Route } from "./+types/audit";
import { formatWhen } from "~/lib/format.ts";
import { cloudflareContext } from "~/shell/context.ts";
import { call } from "~/shell/services.server.ts";
import { assertGrant, requireScope } from "~/shell/session.server.ts";
import { scopePath } from "~/shell/scope.ts";
import { LEVEL_LABELS } from "../lib.tsx";

export const meta: Route.MetaFunction = () => [{ title: "Connections audit · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const { services } = args.context.get(cloudflareContext);
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.connections.audit.read");
  // Tenant-wide reading needs the grant *at the tenant*; a project-scoped grant only sees this project.
  const tenantWide = hasGrant(session.tenantCtx, "tpx.connections.audit.read");
  const wantTenant = new URL(args.request.url).searchParams.get("scope") === "tenant";
  const scope = tenantWide && wantTenant ? "tenant" : "project";
  const entries =
    scope === "tenant"
      ? await call(services.connections.listAudit(session.tenantCtx, { limit: 200 }))
      : await call(services.connections.listAudit(session.ctx, { limit: 200, projectId: session.project.id }));
  return {
    entries,
    scope,
    tenantWide,
    project: session.project,
    base: scopePath(session.project.slug, session.environment.name),
  };
}

function toneFor(action: string): BadgeTone {
  if (action === "secret.reveal") return "warning";
  if (action.endsWith(".delete") || action === "binding.clear") return "danger";
  if (action === "capability.execute" || action === "connection.test") return "neutral";
  return "accent";
}

export default function ConnectionsAudit({ loaderData }: Route.ComponentProps) {
  const { entries, scope, tenantWide, base } = loaderData;
  return (
    <>
      <PageHeader
        eyebrow="Connections"
        title="Audit"
        description="Every write, every reveal, every execution — with the level that supplied the credential."
        actions={
          tenantWide ? (
            <div className="flex rounded-sm bg-surface-raised p-0.5 text-sm" role="tablist">
              <Link
                to={`${base}/connections/audit`}
                role="tab"
                aria-selected={scope === "project"}
                className={cn(
                  "rounded-sm px-3 py-1 font-medium",
                  scope === "project" ? "bg-accent text-on-accent" : "text-ink-muted hover:text-ink",
                )}
              >
                This project
              </Link>
              <Link
                to={`${base}/connections/audit?scope=tenant`}
                role="tab"
                aria-selected={scope === "tenant"}
                className={cn(
                  "rounded-sm px-3 py-1 font-medium",
                  scope === "tenant" ? "bg-accent text-on-accent" : "text-ink-muted hover:text-ink",
                )}
              >
                Whole tenant
              </Link>
            </div>
          ) : null
        }
      />
      <Card>
        <CardHeader
          title={scope === "tenant" ? "Tenant activity" : `${loaderData.project.name} activity`}
          description={`${entries.length} most recent entries`}
        />
        {entries.length === 0 ? (
          <EmptyState icon={<ScrollText size={28} />} title="No activity yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Level</TH>
                <TH>Actor</TH>
                <TH>Detail</TH>
              </tr>
            </THead>
            <TBody>
              {entries.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs text-ink-muted">{formatWhen(e.at)}</TD>
                  <TD>
                    <Badge tone={toneFor(e.action)}>{e.action}</Badge>
                  </TD>
                  <TD className="font-mono text-xs">{e.target}</TD>
                  <TD className="text-xs text-ink-muted">{e.level ? LEVEL_LABELS[e.level] : "—"}</TD>
                  <TD className="font-mono text-xs">{e.userId}</TD>
                  <TD
                    className="max-w-md truncate font-mono text-xs text-ink-muted"
                    title={e.detail === undefined ? "" : JSON.stringify(e.detail)}
                  >
                    {e.detail === undefined ? "" : JSON.stringify(e.detail)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
