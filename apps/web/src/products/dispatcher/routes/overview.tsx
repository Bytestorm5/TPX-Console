import { Ticket } from "lucide-react";
import { hasGrant } from "@tpx/identity";
import { Badge, Card, EmptyState, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/overview";
import { ErrorSection } from "~/shell/components/ErrorSection.tsx";
import { assertGrant, requireScope } from "~/shell/session.server.ts";

export const meta: Route.MetaFunction = () => [{ title: "Dispatcher · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.dispatcher.overview.read");
  return {
    project: session.project,
    environment: session.environment,
    canAct: hasGrant(session.ctx, "tpx.dispatcher.overview.manage_tickets"),
  };
}

export default function DispatcherOverview({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        eyebrow={`${loaderData.project.name} · ${loaderData.environment.name}`}
        title="Dispatcher"
        description="Tickets, classification and agent dispatch."
        actions={<Badge tone="accent">preview</Badge>}
      />
      <Card>
        <EmptyState
          icon={<Ticket size={28} />}
          title="Dispatcher is not wired up yet"
          description={`Dispatcher will triage tickets for this project and dispatch agents to them. The service is not part of this build; the shell already knows how to mount it. ${loaderData.canAct ? "You would be able to act here." : "You would have read-only access here."}`}
        />
      </Card>
    </>
  );
}

export function ErrorBoundary() {
  return <ErrorSection title="Dispatcher is unavailable" />;
}
