import type { ReactNode } from "react";
import { Emblem } from "./Logo.tsx";

/**
 * The frame around Clerk's sign-in and sign-up: the brand on a dark ground
 * (the kit's default application), the form on the light side.
 */
export function AuthPanel({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[5fr_7fr]">
      <section className="relative hidden overflow-hidden bg-ebony text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <Emblem size={36} />
          <span className="text-lg font-bold tracking-tight">Trusplex</span>
        </div>
        <div>
          <h1 className="max-w-md text-4xl font-bold leading-[0.98] tracking-[-0.03em] xl:text-5xl">
            One console for every product you run.
          </h1>
          <p className="mt-6 max-w-md text-space">
            Connections configured once, every product able to use them. Sign in to your workspace.
          </p>
        </div>
        <p className="text-sm text-space">Crafting Tomorrow, Together.</p>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full bg-brand opacity-60 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 right-10 h-40 w-64 rounded-full bg-brand opacity-40 blur-2xl"
        />
      </section>
      <section className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Emblem size={30} />
            <span className="text-base font-bold tracking-tight text-ink">Trusplex</span>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

export function FixtureAuthCard({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-raised p-8">
      <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Clerk mounts here. Development fixture mode is on, so this build has no sign-in step.
      </p>
      <a
        href="/"
        className="mt-6 inline-flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent"
      >
        Continue to the console
      </a>
    </div>
  );
}
