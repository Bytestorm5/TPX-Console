# Trusplex Console

One repository, one Cloudflare Worker, one public application. `tpx-web` serves the console and mounts every service in-process: each service is its own part of the codebase (`services/<name>`) with its own store, contract and tests, and the shell calls it with a plain method call. Clerk signs users in (and nothing more); [Alfiz](https://www.npmjs.com/package/@alfiz/core) owns tenants, membership and what everyone may do; one Convex deployment stores the data, tables prefixed by service.

```
apps/web            tpx-web — the Worker: assets, SSR, the /api/<product>/* forwarder, every service mounted in-process
services/auth       the auth service — tenancy (tenants, projects, environments) + the Alfiz authorization root
services/connections the connections service — encrypted credentials, providers, resolution, audit
packages/contracts  Zod schemas + service interfaces shared by the shell and the services (also the event bus definitions)
packages/identity   the Alfiz catalog, roles, scope helpers, typed errors
packages/tokens     the Trusplex design tokens (CSS variables, Tailwind theme, JS mirror)
packages/ui         the console's primitives, built on the tokens only
packages/convex     the single Convex deployment: every service's functions and service-prefixed tables
packages/convex-client a tiny caller for Convex's HTTP API from the Worker
scripts/            the boundary checks CI runs
```

A _service_ here is a library, not a deployable. `services/auth` exports `AuthService`; the Worker entry (`apps/web/workers/app.ts`) constructs it with the Worker's env, and loaders, actions and the `/api` forwarder call its methods directly. Nothing reaches a service from the network except through the shell, which resolves the identity and the scope first.

## Run it

```sh
pnpm install
pnpm dev:fixture          # http://localhost:5173 — no Clerk, no Convex needed
```

`dev:fixture` runs the Worker in workerd exactly as in production — the console and both services in one isolate — with a fixture identity (`Ada Fixture`, who gets "Ada's Org" on first sign-in) and in-memory stores. It is the fastest way to see the console and what the Playwright suite runs against.

For the real thing, see [docs/setup.md](docs/setup.md): Clerk keys, the Convex deployment, and the secrets the Worker needs.

## Check it

```sh
pnpm check                # typecheck + lint + boundaries + topology + every test suite
pnpm test:ui              # Playwright, end to end, in fixture mode (screenshots with TPX_E2E_SHOTS=<dir>)
```

The four boundary rules from the structure doc are enforced mechanically, in ESLint (`eslint.config.mjs`) and again dependency-free in `scripts/` so CI can run them before installing anything:

1. no cross-product imports — a product imports its own files, `~/shell`, `~/lib` and `@tpx/*` (its own contract only);
2. no service-to-service imports, and no Worker entrypoints — a service imports its own files and `@tpx/*`, never another service, the app, or `cloudflare:workers`; shared logic goes to `packages/`;
3. no raw hex or px in products, the shell or the UI kit — tokens only;
4. one Worker — `apps/web/wrangler.jsonc` is the only Worker config in the repository, and it declares no service bindings (`scripts/check-topology.mjs`).

## How it fits together

Read [docs/architecture.md](docs/architecture.md) for the Worker and its services, the scope model (tenant → project → environment), the request path (Clerk session → tenant → scope → Alfiz snapshot → `Ctx`), how the shell mounts products, and how connections resolve (binding → attachment → connection default → connection base).

[docs/security.md](docs/security.md) covers what protects the secrets: envelope encryption in the connections service, tenant-only grants for the dangerous verbs, fresh checks for destructive actions, and the audit trail.
