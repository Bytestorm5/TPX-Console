/**
 * The Clerk-backed controls: the organization (tenant) switcher under the
 * logo and the user bubble at the bottom. In fixture mode they render
 * static stand-ins so the shell can be developed and screenshotted without
 * Clerk keys.
 */
import { OrganizationSwitcher, UserButton } from "@clerk/react-router";
import { Building, ChevronsUpDown } from "lucide-react";

export function TenantSwitcher({ mode, tenantName }: { mode: "clerk" | "fixture"; tenantName: string }) {
  if (mode === "clerk") {
    return (
      <div className="rounded-sm border border-border-subtle bg-surface px-1">
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
          appearance={{
            elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between px-2 py-2 text-ink" },
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface px-3 py-2 text-sm text-ink">
      <Building size={16} className="text-ink-muted" />
      <span className="min-w-0 flex-1 truncate font-medium">{tenantName}</span>
      <ChevronsUpDown size={14} className="text-ink-muted" />
    </div>
  );
}

export function UserBubble({
  mode,
  name,
  email,
}: {
  mode: "clerk" | "fixture";
  name: string | null;
  email: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {mode === "clerk" ? (
        <UserButton appearance={{ elements: { avatarBox: "h-9 w-9" } }} />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
          aria-hidden="true"
        >
          {(name ?? "?").slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{name ?? "Signed in"}</p>
        {email ? <p className="truncate text-xs text-ink-muted">{email}</p> : null}
      </div>
    </div>
  );
}
