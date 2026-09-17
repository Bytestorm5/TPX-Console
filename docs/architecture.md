# Architecture

## Workers and bindings

```
browser ──HTTPS──▶ tpx-web (apps/web)  ──service binding──▶ tpx-auth (services/auth)  ──HTTPS──▶ Convex deployment A
                        │                                    (Alfiz root, tenancy)
                        └────────service binding──────────▶ tpx-connections (services/connections) ──HTTPS──▶ Convex deployment B
                                                             (secrets, providers, resolution, audit)
```

- **tpx-web** is the only Worker with a route (`console.trusplex.com`). It renders the console (React Router framework mode, SSR on the edge), forwards `/api/<product>/*` to the product's binding, and holds every service binding.
- **Services** are `WorkerEntrypoint` classes. tpx-web calls their methods over RPC; the interfaces live in `packages/contracts` so both sides compile against the same types. `fetch` on a service only answers `/healthz` without a context, and everything else needs the `x-tpx-ctx` header the forwarder adds — `scripts/check-service-routes.mjs` fails CI if any service config ever grows a route.
- **Convex** is the datastore, one deployment per service. Every Convex function is `internalQuery`/`internalMutation`, called with the deploy key from the Worker (`packages/convex-client`); nothing in Convex is reachable from a browser. `TPX_STORE=memory` swaps in an in-memory store for local development and the Worker-runtime tests.
- **Wrangler config** is committed per Worker (topology: bindings, compatibility, `env.staging`). Vars and secrets live in the dashboard, so every config sets `keep_vars: true`; `secrets.required` lists what each Worker needs.

## Scope model

```
Tenant (= Clerk organization)
└── Project (slug)            /<project>
    └── Environment (name)    /<project>/<environment>/<product>/…
```

- Environments are **tenant vocabulary**: `tenant.environments` lists the allowed names and `tenant.projectDefaults` what new projects get. Connection defaults are keyed by these names, which is why `dev` and `develop` can never become two keys.
- `/<project>` (two segments) redirects to the project's default environment (`/org/...` pages are tenant-level).
- `Scope = { tenantId, projectId, environmentId }`; `Ctx = Scope & { environmentName, userId, grants }` is what every service method takes. Products never see a session, only a `Ctx`.

## The request path

`root.tsx` middleware: `identityMiddleware` (Clerk, or the fixture in dev) → the scoped layout's `scopeMiddleware`:

1. `ensureUser` records the org membership and mirrors Clerk `org:admin` as a `tpx-admin` grant (provenance `clerk:org:admin`, so it is revoked when the Clerk role changes);
2. `findTenant` / `ensureTenant` — the first visit from an organization creates the tenant, grants the creator `tpx-owner`, gives `org:<id>` `tpx-member`, and creates the `Default` project with the vocabulary defaults;
3. `resolveScope` turns the URL into ids, or 404 (never revealing whether a project exists);
4. an Alfiz `snapshot` of the user at the environment scope → `grantsAt` → `Ctx`.

tpx-web is an Alfiz _client_ with a read-only provider seam over tpx-auth (`getSubjectAccess`, `resolveAncestors`, epoch revalidation). Services re-check `requireGrant(ctx, key)` on every method, and tpx-auth runs a **fresh** (uncached) `can` check before destructive or authority-changing writes.

### Onboarding

A signed-in user without an organization lands on `/onboarding`, which creates `<First name>'s Org` through Clerk's Backend API and activates it; the first scoped request then bootstraps the tenant as above. Users can create more organizations from the tenant switcher (Clerk's `OrganizationSwitcher`).

## The shell and the products

```
shell (Frame + Sidebar)  →  product layout (error boundary, product gate)  →  page
```

- `apps/web/src/registry.ts` imports one **manifest** per product (`id`, `title`, `icon`, `binding`, `requires` pattern, `nav`); `registry.routes.ts` imports each product's route list. Nothing else couples the shell to a product.
- The sidebar is built server-side from the manifests, the user's grants at the scope, and each service's `capabilities()` (a disabled product, or one the user holds no key under, does not render; nav entries can `require` a key or a feature). Which entry is _active_ is computed on the client from the location. Products without a service (Operator, Dispatcher, Integrator) ship preview manifests and appear only while `TPX_PREVIEW_PRODUCTS` lists them.
- Each product subtree has its own `ErrorBoundary`: a failing service is a broken section, not a broken console.
- Every product page starts with `requireScope(args)` and `assertGrant(ctx, key)`; actions re-assert before calling a service.

## Connections

```
Connection  (tenant)                     provider, capabilities, base config + credential,
                                         per-environment defaults keyed by environment NAME
Attachment  (connection × project)       named; one default per capability; project-wide overrides
Binding     (attachment × environment)   this project's overrides for this environment
```

Resolution is innermost-first — binding → attachment → connection default for an environment with this name → connection base — and the console badges every resolved field **overridden** (binding/attachment) or **inherited** (connection). Promotion between environments is an explicit action: `planPromotion` returns a diff with a digest, and `promote` refuses a digest that no longer matches.

Products never name a connection. They ask `CONNECTIONS.resolve(ctx, capability, name?)` for the redacted view or `CONNECTIONS.execute(ctx, capability, name, op, args)` to run something with the credential, which never leaves the connections Worker.

## Events

`packages/contracts/src/events.ts` defines the queues and event schemas services will publish and consume; no queue bindings are declared yet, so nothing is dispatched.
