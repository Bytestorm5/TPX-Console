import { Server } from "lucide-react";
import { hasGrant } from "@tpx/identity";
import { Badge, Card, EmptyState, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/overview";
import { ErrorSection } from "~/shell/components/ErrorSection.tsx";
import { assertGrant, requireScope } from "~/shell/session.server.ts";

export const meta: Route.MetaFunction = () => [{ title: "Operator · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.operator.overview.read");
  return {
    project: session.project,
    environment: session.environment,
    canAct: hasGrant(session.ctx, "tpx.operator.overview.manage_servers"),
  };
}

export default function OperatorOverview({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        eyebrow={`${loaderData.project.name} · ${loaderData.environment.name}`}
        title="Operator"
        description="Ops state and actions for the servers a project runs on."
        actions={<Badge tone="accent">preview</Badge>}
      />
      <Card>
        <EmptyState
          icon={<Server size={28} />}
          title="Operator is not wired up yet"
          description={`Operator will show the servers behind this project and let you act on them. The service is not part of this build; the shell already knows how to mount it. ${loaderData.canAct ? "You would be able to act here." : "You would have read-only access here."}`}
        />
      </Card>
    </>
  );
}

export function ErrorBoundary() {
  return <ErrorSection title="Operator is unavailable" />;
}
