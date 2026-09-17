import { Radar } from "lucide-react";
import { hasGrant } from "@tpx/identity";
import { Badge, Card, EmptyState, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/overview";
import { ErrorSection } from "~/shell/components/ErrorSection.tsx";
import { assertGrant, requireScope } from "~/shell/session.server.ts";

export const meta: Route.MetaFunction = () => [{ title: "Integrator · Trusplex Console" }];

export async function loader(args: Route.LoaderArgs) {
  const session = requireScope(args);
  assertGrant(session.ctx, "tpx.integrator.overview.read");
  return {
    project: session.project,
    environment: session.environment,
    canAct: hasGrant(session.ctx, "tpx.integrator.overview.manage_monitors"),
  };
}

export default function IntegratorOverview({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        eyebrow={`${loaderData.project.name} · ${loaderData.environment.name}`}
        title="Integrator"
        description="Contract monitoring and change detection."
        actions={<Badge tone="accent">preview</Badge>}
      />
      <Card>
        <EmptyState
          icon={<Radar size={28} />}
          title="Integrator is not wired up yet"
          description={`Integrator will watch the contracts this project depends on and flag changes. The service is not part of this build; the shell already knows how to mount it. ${loaderData.canAct ? "You would be able to act here." : "You would have read-only access here."}`}
        />
      </Card>
    </>
  );
}

export function ErrorBoundary() {
  return <ErrorSection title="Integrator is unavailable" />;
}
