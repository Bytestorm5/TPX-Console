# Architecture

## One Worker, several services

```
browser ──HTTPS──▶ tpx-web (apps/web) — one Worker, one isolate
                     ├── the shell: assets, SSR, the /api/<product>/* forwarder
                     ├── auth service (services/auth)               ──HTTPS──▶ Convex, auth_* tables
                     │     the Alfiz root, tenancy
                     └── connections service (services/connections) ──HTTPS──▶ Convex, connections_* tables
                           secrets, providers, resolution, audit
```

- **tpx-web** is the one Worker, and the only thing with a route (`console.trusplex.com`). It renders the console (React Router framework mode, SSR on the edge), forwards `/api/<product>/*` to the product's service, and mounts every service.
- **Services are libraries, not Workers.** Each lives in `services/<name>` with its own store seam, tests and `package.json`, and exports a class (`AuthService`, `ConnectionsService`) that takes the Worker's env — the slice it reads is its `*Env` type, and `WebEnv` is the union. The Worker entry (`apps/web/workers/app.ts`) constructs them once per isolate (`shell/services.server.ts`) and puts them on the router context, so a loader calls `services.auth.listProjects(ctx)` as a plain method call. The interfaces live in `packages/contracts`, so the shell compiles against the contract, not the implementation. A service's `handle(ctx, request)` is the JSON surface behind the forwarder; it has no other HTTP surface and no network identity of its own.
- **Why one Worker.** The systems stay separate parts of the codebase — separate packages, separate tables, separate test suites, and a boundary rule that keeps them from importing each other — without being separate deployables. A call between them costs a function call, there is one config to keep in step, one set of secrets, one deploy. Nothing in a service assumes it is in-process, either: it never reaches for the runtime (`cloudflare:workers` is off limits, lint-enforced), so splitting one back out would mean giving it an entrypoint and the shell a binding, and nothing else.
- **Convex** is the datastore, one deployment for the whole console, tables prefixed by service. Every Convex function is `internalQuery`/`internalMutation`, called with the deploy key from the Worker (`packages/convex-client`); nothing in Convex is reachable from a browser. `TPX_STORE=memory` swaps in in-memory stores for local development and the services' Worker-runtime tests.
- **Wrangler config** is committed once, in `apps/web/wrangler.jsonc` (topology: the route, compatibility, `env.staging`). Vars and secrets live in the dashboard, so the config sets `keep_vars: true`; `secrets.required` lists what the Worker needs, which is the union of what its services need. `scripts/check-topology.mjs` fails CI if a second Worker config or a service binding ever appears.

## Scope model

```
Tenant (the auth service's own; Clerk only authenticates)
└── Project (slug)            /<project>
    └── Environment (name)    /<project>/<environment>/<product>/…
```

- Environments are **tenant vocabulary**: `tenant.environments` lists the allowed names and `tenant.projectDefaults` what new projects get. Connection defaults are keyed by these names, which is why `dev` and `develop` can never become two keys.
- `/<project>` (two segments) redirects to the project's default environment (`/org/...` pages are tenant-level).
- `Scope = { tenantId, projectId, environmentId }`; `Ctx = Scope & { environmentName, userId, grants }` is what every service method takes. Products never see a session, only a `Ctx`.

## The request path

`root.tsx` middleware: `identityMiddleware` (Clerk, or the fixture in dev) → the scoped layout's `scopeMiddleware`:

1. `ensureUser` — the auth service records the user (profile cached from Clerk, refreshed hourly), claims any invitation addressed to their email, and, for a user who belongs to no tenant, creates "<First name>'s Org" with them as `tpx-owner`, `org:<tenantId>` as `tpx-member`, and a `Default` project. It returns the tenants they belong to.
2. The active tenant is the one remembered in the `tpx_tenant` cookie if the user is a member of it, else the first membership. A cookie can never name a tenant the user is not in.
3. `resolveScope` turns the URL into ids, or 404 (never revealing whether a project exists);
4. an Alfiz `snapshot` of the user at the environment scope → `grantsAt` → `Ctx`.

Membership is the console's own (`auth_memberships`) and is mirrored into Alfiz's directory as the user's org ids, which is what makes `org:<tenantId>` part of the user's closure and tenant-wide grants apply. Clerk organizations are not used.

The shell is an Alfiz _client_ with a read-only provider seam over the auth service (`getSubjectAccess`, `resolveAncestors`, epoch revalidation). The seam is an in-process call, but the client still evaluates checks locally over the closure data it fetched and caches it, so a check never touches the store. Services re-check `requireGrant(ctx, key)` on every method, and the auth service runs a **fresh** (uncached) `can` check before destructive or authority-changing writes.

Failures are typed: services throw a `TpxError` (`status`, `code`, `detail`), `call()` in the shell turns one into the matching error response (the 403 section, the 404 page) and `attempt()` into an inline action error, and the `/api` surface serialises it as `{ error, code }` with the status.

### Organizations, members, invitations

- The tenant switcher in the sidebar lists the user's memberships and links to `/org/new`, where any signed-in user creates another tenant and becomes its owner.
- Members (`/org/members`) are invited by email with a seed role. A known user (one who has signed in before) joins at once; anyone else gets a pending invitation that is claimed on their first sign-in with that address. Removing a member sweeps every grant they hold inside the tenant; the last owner cannot be removed.
- Clerk's only webhook of interest is `user.deleted`, which forgets the user everywhere.

## The shell and the products

```
shell (Frame + Sidebar)  →  product layout (error boundary, product gate)  →  page
```

- `apps/web/src/registry.ts` imports one **manifest** per product (`id`, `title`, `icon`, `service`, `requires` pattern, `nav`); `registry.routes.ts` imports each product's route list. Nothing else couples the shell to a product.
- The sidebar is built server-side from the manifests, the user's grants at the scope, and each service's `capabilities()` (a disabled product, or one the user holds no key under, does not render; nav entries can `require` a key or a feature). Which entry is _active_ is computed on the client from the location. Products without a service (Operator, Dispatcher, Integrator) ship preview manifests and appear only while `TPX_PREVIEW_PRODUCTS` lists them.
- Each product subtree has its own `ErrorBoundary`: a failing service is a broken section, not a broken console.
- Every product page starts with `requireScope(args)` and `assertGrant(ctx, key)`; actions re-assert before calling a service.

### The `/api/<product>/*` forwarder

The same services answer a JSON API for non-browser clients. `routes/api.tsx` resolves the scope from the `x-tpx-project` / `x-tpx-environment` headers exactly as a page would, refuses anything the user holds no grant for, and hands the product's service a request whose URL is relative to the product root, with the resolved `Ctx` as an argument (`service.handle(ctx, request)`). Every handler goes through the same methods the loaders call, so grants and audit are identical whichever way a call arrives.

## Connections

```
Connection  (tenant)                     provider, capabilities, base config + credential,
                                         per-environment defaults keyed by environment NAME
Attachment  (connection × project)       named; one default per capability; project-wide overrides
Binding     (attachment × environment)   this project's overrides for this environment
```

Resolution is innermost-first — binding → attachment → connection default for an environment with this name → connection base — and the console badges every resolved field **overridden** (binding/attachment) or **inherited** (connection). Promotion between environments is an explicit action: `planPromotion` returns a diff with a digest, and `promote` refuses a digest that no longer matches.

Products never name a connection. They ask `services.connections.resolve(ctx, capability, name?)` for the redacted view or `services.connections.execute(ctx, capability, name, op, args)` to run something with the credential, which never leaves the connections service.

## Events

`packages/contracts/src/events.ts` defines the queues and event schemas services will publish and consume; no queue bindings are declared yet, so nothing is dispatched.
