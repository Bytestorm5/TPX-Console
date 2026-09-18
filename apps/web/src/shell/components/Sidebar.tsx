import {
  Building,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Layers,
  LayoutDashboard,
  ScrollText,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import type { Environment, Project, TenantSummary } from "@tpx/contracts/auth";
import { Badge, cn } from "@tpx/ui";
import { activeItem, isGroupActive, type NavGroup, type NavItem } from "../nav.ts";
import { products } from "../../registry.ts";
import { Emblem, Wordmark } from "./Logo.tsx";
import { ScopeSwitcher } from "./ScopeSwitcher.tsx";
import { TenantSwitcher, UserBubble } from "./SessionControls.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export interface SidebarProps {
  mode: "clerk" | "fixture";
  tenantId: string;
  tenantName: string;
  tenants: TenantSummary[];
  user: { name: string | null; email: string | null };
  projects: Project[];
  project: Project | null;
  environments: Environment[];
  environment: Environment | null;
  /** `/<project>/<environment>` when a scope is active. */
  scopeBase: string | null;
  productGroups: NavGroup[];
  workspace: NavGroup;
  theme: "light" | "dark" | null;
}

/**
 * The frame's left rail: logo and name on top, the tenant switcher, the
 * scope switcher, the product groups (each a collapsible set of tabs that
 * opens when you enter the product), the workspace group, and the Clerk
 * user bubble at the bottom.
 */
export function Sidebar(props: SidebarProps) {
  const { pathname } = useLocation();
  return (
    <aside className="flex h-full w-sidebar shrink-0 flex-col border-r border-border-subtle bg-surface-sunken">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <Emblem size={30} />
        <Wordmark />
      </div>
      <div className="space-y-2 px-4">
        <TenantSwitcher tenantId={props.tenantId} tenantName={props.tenantName} tenants={props.tenants} />
        <ScopeSwitcher
          projects={props.projects}
          project={props.project}
          environments={props.environments}
          environment={props.environment}
        />
      </div>
      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {props.scopeBase ? (
          <NavLink
            to={props.scopeBase}
            end
            className={({ isActive }) =>
              cn(
                "mb-1 flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-raised",
              )
            }
          >
            <LayoutDashboard size={18} />
            Overview
          </NavLink>
        ) : null}
        {props.productGroups.length > 0 ? (
          <p className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Products</p>
        ) : null}
        {props.productGroups.map((group) => (
          <ProductGroup key={group.id} group={group} pathname={pathname} />
        ))}
        <p className="mt-4 mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Workspace</p>
        <ProductGroup group={props.workspace} pathname={pathname} />
      </nav>
      <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
        <UserBubble mode={props.mode} name={props.user.name} email={props.user.email} />
        <ThemeToggle initial={props.theme} />
      </div>
    </aside>
  );
}

const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  "/org/projects": Layers,
  "/org/environments": Building,
  "/org/members": Users,
  "/org/access": KeyRound,
  "/org/audit": ScrollText,
  "/org/settings": Settings2,
};

/** Icons come from the manifests (client-side), never through loader data. */
function iconsFor(group: NavGroup): { group: LucideIcon; item: (item: NavItem) => LucideIcon | undefined } {
  if (group.id === "workspace") return { group: Building, item: (item) => WORKSPACE_ICONS[item.path] };
  const manifest = products.find((m) => m.id === group.id);
  return {
    group: manifest?.icon ?? Building,
    item: (item) => manifest?.nav.find((entry) => entry.path === item.path)?.icon,
  };
}

function ProductGroup({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = isGroupActive(group, pathname);
  const current = activeItem(group, pathname);
  const icons = iconsFor(group);
  // A manual toggle holds only while the group's active state is unchanged:
  // entering a product opens it, leaving it lets it fold again.
  const [override, setOverride] = useState<{ active: boolean; open: boolean } | null>(null);
  const open = override && override.active === active ? override.open : active;
  const Icon = icons.group;
  return (
    <div className="mb-0.5" data-nav-group={group.id} data-active={active ? "true" : "false"}>
      <div
        className={cn(
          "flex items-center rounded-sm text-sm font-medium transition-colors",
          active ? "bg-surface-raised text-ink" : "text-ink hover:bg-surface-raised",
        )}
      >
        <Link
          to={group.to}
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2"
          onClick={() => setOverride({ active: true, open: true })}
        >
          <Icon size={18} className={active ? "text-accent" : "text-ink-muted"} />
          <span className="truncate">{group.title}</span>
          {group.preview ? (
            <Badge tone="neutral" className="ml-1">
              preview
            </Badge>
          ) : null}
        </Link>
        <button
          type="button"
          onClick={() => setOverride({ active, open: !open })}
          aria-label={`${open ? "Collapse" : "Expand"} ${group.title}`}
          aria-expanded={open}
          className="mr-1 rounded-sm p-1.5 text-ink-muted hover:text-ink"
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      {open ? (
        <ul className="my-1 ml-4 space-y-0.5 border-l border-border-subtle pl-2">
          {group.items.map((item) => {
            const ItemIcon = icons.item(item);
            const isCurrent = item.to === current;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors",
                    isCurrent
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-ink-muted hover:bg-surface-raised hover:text-ink",
                  )}
                >
                  {ItemIcon ? <ItemIcon size={15} /> : null}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
