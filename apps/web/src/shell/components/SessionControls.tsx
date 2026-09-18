/**
 * The tenant switcher under the logo (the console's own: tenants live in
 * the auth service, not in the identity provider) and the user bubble at the
 * bottom (Clerk's, or a static stand-in in fixture mode).
 */
import { UserButton } from "@clerk/react-router";
import { Building, Check, ChevronsUpDown, Plus } from "lucide-react";
import { Form, Link } from "react-router";
import type { TenantSummary } from "@tpx/contracts/auth";
import { cn } from "@tpx/ui";

export function TenantSwitcher({
  tenantId,
  tenantName,
  tenants,
}: {
  tenantId: string;
  tenantName: string;
  tenants: TenantSummary[];
}) {
  return (
    <details className="group relative" data-testid="tenant-switcher">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm border border-border-subtle bg-surface px-3 py-2 text-sm text-ink [&::-webkit-details-marker]:hidden">
        <Building size={16} className="text-ink-muted" />
        <span className="min-w-0 flex-1 truncate font-medium">{tenantName}</span>
        <ChevronsUpDown size={14} className="text-ink-muted" />
      </summary>
      <div className="absolute left-0 right-0 z-20 mt-1 rounded-md border border-border-subtle bg-surface p-1 shadow-md">
        <p className="px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Organizations</p>
        <ul>
          {tenants.map((t) => (
            <li key={t.id}>
              <Form method="post" action="/org/switch">
                <input type="hidden" name="tenantId" value={t.id} />
                <button
                  type="submit"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    t.id === tenantId ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-raised",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.id === tenantId ? <Check size={14} /> : null}
                </button>
              </Form>
            </li>
          ))}
        </ul>
        <Link
          to="/org/new"
          className="mt-1 flex items-center gap-2 rounded-sm border-t border-border-subtle px-2 py-2 text-sm text-ink hover:bg-surface-raised"
        >
          <Plus size={14} /> New organization
        </Link>
      </div>
    </details>
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
