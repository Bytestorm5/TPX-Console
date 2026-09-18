# Architecture

## Workers and bindings

```
browser ──HTTPS──▶ tpx-web (apps/web)  ──service binding──▶ tpx-auth (services/auth)  ──HTTPS──▶ Convex ◀──┐
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
Tenant (tpx-auth's own; Clerk only authenticates)
└── Project (slug)            /<project>
    └── Environment (name)    /<project>/<environment>/<product>/…
```

- Environments are **tenant vocabulary**: `tenant.environments` lists the allowed names and `tenant.projectDefaults` what new projects get. Connection defaults are keyed by these names, which is why `dev` and `develop` can never become two keys.
- `/<project>` (two segments) redirects to the project's default environment (`/org/...` pages are tenant-level).
- `Scope = { tenantId, projectId, environmentId }`; `Ctx = Scope & { environmentName, userId, grants }` is what every service method takes. Products never see a session, only a `Ctx`.

## The request path

`root.tsx` middleware: `identityMiddleware` (Clerk, or the fixture in dev) → the scoped layout's `scopeMiddleware`:

1. `ensureUser` — tpx-auth records the user (profile cached from Clerk, refreshed hourly), claims any invitation addressed to their email, and, for a user who belongs to no tenant, creates "<First name>'s Org" with them as `tpx-owner`, `org:<tenantId>` as `tpx-member`, and a `Default` project. It returns the tenants they belong to.
2. The active tenant is the one remembered in the `tpx_tenant` cookie if the user is a member of it, else the first membership. A cookie can never name a tenant the user is not in.
3. `resolveScope` turns the URL into ids, or 404 (never revealing whether a project exists);
4. an Alfiz `snapshot` of the user at the environment scope → `grantsAt` → `Ctx`.

Membership is the console's own (`auth_memberships`) and is mirrored into Alfiz's directory as the user's org ids, which is what makes `org:<tenantId>` part of the user's closure and tenant-wide grants apply. Clerk organizations are not used.

tpx-web is an Alfiz _client_ with a read-only provider seam over tpx-auth (`getSubjectAccess`, `resolveAncestors`, epoch revalidation). Services re-check `requireGrant(ctx, key)` on every method, and tpx-auth runs a **fresh** (uncached) `can` check before destructive or authority-changing writes.

### Organizations, members, invitations

- The tenant switcher in the sidebar lists the user's memberships and links to `/org/new`, where any signed-in user creates another tenant and becomes its owner.
- Members (`/org/members`) are invited by email with a seed role. A known user (one who has signed in before) joins at once; anyone else gets a pending invitation that is claimed on their first sign-in with that address. Removing a member sweeps every grant they hold inside the tenant; the last owner cannot be removed.
- Clerk's only webhook of interest is `user.deleted`, which forgets the user everywhere.

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
