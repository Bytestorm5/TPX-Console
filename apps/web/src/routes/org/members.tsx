import { OrganizationProfile } from "@clerk/react-router";
import { Card, CardHeader, PageHeader } from "@tpx/ui";
import type { Route } from "./+types/members";
import { cloudflareContext } from "../../shell/context.ts";
import { isFixtureMode } from "../../shell/env.ts";
import { requireTenant } from "../../shell/session.server.ts";

export const meta: Route.MetaFunction = () => [{ title: "Members · Trusplex Console" }];

export function loader(args: Route.LoaderArgs) {
  const session = requireTenant(args);
  return { tenant: session.tenant, fixture: isFixtureMode(args.context.get(cloudflareContext).env) };
}

export default function Members({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader
        eyebrow={loaderData.tenant.name}
        title="Members"
        description="Membership and invitations are managed by Clerk. Every member holds the Member role here; Clerk admins are mirrored as Admins; finer grants live under Access."
      />
      <Card className="p-2">
        {loaderData.fixture ? (
          <div className="p-6">
            <CardHeader
              title="Organization profile"
              description="Clerk's OrganizationProfile mounts here in production."
            />
          </div>
        ) : (
          <OrganizationProfile
            routing="hash"
            appearance={{ elements: { rootBox: "w-full", cardBox: "w-full shadow-none border-0" } }}
          />
        )}
      </Card>
    </>
  );
}
