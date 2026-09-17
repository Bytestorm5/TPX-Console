import { OrganizationList, useClerk } from "@clerk/react-router";
import { clerkClient } from "@clerk/react-router/server";
import { useEffect } from "react";
import { redirect, useNavigate } from "react-router";
import { defaultTenantName } from "@tpx/identity";
import type { Route } from "./+types/onboarding";
import { AuthPanel } from "../shell/components/AuthPanel.tsx";
import { cloudflareContext } from "../shell/context.ts";
import { isFixtureMode } from "../shell/env.ts";
import { requireSignedIn } from "../shell/identity.server.ts";

/**
 * A new user gets a tenant by default: "<First name>'s Org", created as a
 * Clerk organization with them as admin. Users who already belong to
 * organizations pick one. Either way the console's tenant row is created on
 * the first scoped request (tpx-auth's ensureTenant).
 */
export async function loader(args: Route.LoaderArgs) {
  const { env } = args.context.get(cloudflareContext);
  if (isFixtureMode(env)) throw redirect("/");
  const identity = await requireSignedIn(args);
  if (identity.orgId) throw redirect("/");
  const clerk = clerkClient(args);
  const memberships = await clerk.users.getOrganizationMembershipList({ userId: identity.userId, limit: 1 });
  if (memberships.totalCount > 0) return { mode: "choose" as const, organizationId: null };
  const user = await clerk.users.getUser(identity.userId);
  const name = defaultTenantName({
    displayName: user.firstName ?? user.fullName,
    email: user.primaryEmailAddress?.emailAddress ?? null,
  });
  const organization = await clerk.organizations.createOrganization({ name, createdBy: identity.userId });
  return { mode: "created" as const, organizationId: organization.id };
}

function ActivateOrganization({ organizationId }: { organizationId: string }) {
  const clerk = useClerk();
  const navigate = useNavigate();
  useEffect(() => {
    void clerk.setActive({ organization: organizationId }).then(() => navigate("/", { replace: true }));
  }, [clerk, navigate, organizationId]);
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised p-8 text-center">
      <p className="text-base font-semibold text-ink">Setting up your workspace…</p>
      <p className="mt-2 text-sm text-ink-muted">
        We created an organization for you. You can rename it or create more at any time.
      </p>
    </div>
  );
}

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  return (
    <AuthPanel>
      {loaderData.mode === "created" && loaderData.organizationId ? (
        <ActivateOrganization organizationId={loaderData.organizationId} />
      ) : (
        <div>
          <h2 className="mb-4 text-xl font-bold tracking-tight text-ink">Choose a workspace</h2>
          <OrganizationList hidePersonal afterSelectOrganizationUrl="/" afterCreateOrganizationUrl="/" />
        </div>
      )}
    </AuthPanel>
  );
}
