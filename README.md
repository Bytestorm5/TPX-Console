# Trusplex Console

One repository, many Cloudflare Workers, one public application. `tpx-web` serves the console; every product is its own Worker, reachable only by service binding; Clerk signs users in; [Alfiz](https://www.npmjs.com/package/@alfiz/core) decides what they may do; Convex stores the data.

```
apps/web            tpx-web — assets, SSR, /api/<product>/* forwarder, every service binding
services/auth       tpx-auth — tenancy (tenants, projects, environments) + the Alfiz authorization root
services/connections tpx-connections — encrypted credentials, providers, resolution, audit
packages/contracts  Zod schemas + RPC interfaces shared by web and services (also the event bus definitions)
packages/identity   the Alfiz catalog, roles, scope helpers, typed errors
packages/tokens     the Trusplex design tokens (CSS variables, Tailwind theme, JS mirror)
packages/ui         the console's primitives, built on the tokens only
packages/convex-client a tiny caller for Convex's HTTP API from Workers
scripts/            the boundary checks CI runs
```

## Run it

```sh
pnpm install
pnpm dev:fixture          # http://localhost:5173 — no Clerk, no Convex needed
```

`dev:fixture` runs the whole topology in workerd (tpx-web plus both services, wired by service bindings exactly as in production) with a fixture identity (`Ada Fixture`, org admin of "Ada's Org") and in-memory stores. It is the fastest way to see the console and what the Playwright suite runs against.

For the real thing, see [docs/setup.md](docs/setup.md): Clerk keys, one Convex deployment per service, and the secrets each Worker needs.

## Check it

```sh
pnpm check                # typecheck + lint + boundaries + service routes + every test suite
pnpm test:ui              # Playwright, end to end, in fixture mode (screenshots with TPX_E2E_SHOTS=<dir>)
```

The four boundary rules from the structure doc are enforced mechanically, in ESLint (`eslint.config.mjs`) and again dependency-free in `scripts/` so CI can run them before installing anything:

1. no cross-product imports — a product imports its own files, `~/shell`, `~/lib` and `@tpx/*` (its own contract only);
2. no service-to-service imports — shared logic goes to `packages/`;
3. no raw hex or px in products, the shell or the UI kit — tokens only;
4. no public routes on service Workers — `workers_dev` and `preview_urls` off, no `routes`, no `assets`.

## How it fits together

Read [docs/architecture.md](docs/architecture.md) for the scope model (tenant → project → environment), the request path (Clerk session → tenant → scope → Alfiz snapshot → `Ctx`), how the shell mounts products, and how connections resolve (binding → attachment → connection default → connection base).

[docs/security.md](docs/security.md) covers what protects the secrets: envelope encryption in the connections Worker, tenant-only grants for the dangerous verbs, fresh checks for destructive actions, and the audit trail.
