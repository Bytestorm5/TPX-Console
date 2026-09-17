import type { ReactNode } from "react";
import { Sidebar, type SidebarProps } from "./Sidebar.tsx";

/** Shell → product layout → page. The shell renders the global chrome and a content region. */
export function Frame({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <Sidebar {...sidebar} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 sm:px-10">{children}</div>
      </main>
    </div>
  );
}
