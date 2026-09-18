# Setup

## Clerk

1. Create a Clerk application. Organizations are **not** needed: Clerk only signs users in; tenants, membership and invitations are the console's own (tpx-auth on Alfiz).
2. tpx-web needs `CLERK_PUBLISHABLE_KEY` (a var in `apps/web/wrangler.jsonc`, or the dashboard) and the secrets `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` (`wrangler secret put`, or `.dev.vars` locally — see `apps/web/.dev.vars.example`).
3. Point a webhook at `https://<console>/webhooks/clerk` for the `user.deleted` event so a deleted account loses its memberships at once.

## Convex

One deployment for the whole console, defined in `packages/convex` (each service's functions in its own folder, its tables prefixed `auth_` / `connections_`):

```sh
cd packages/convex && npx convex dev        # creates the deployment, pushes the schema and functions, runs codegen
```

Then give every Worker the same `CONVEX_URL` (var) and `CONVEX_DEPLOY_KEY` (secret). `packages/convex/convex/_generated` is committed so the repository typechecks without a deployment; `npx convex dev` regenerates it.

## Secrets

| Worker          | Secret                            | Purpose                                      |
| --------------- | --------------------------------- | -------------------------------------------- |
| tpx-web         | `CLERK_SECRET_KEY`                | Clerk session verification                   |
| tpx-web         | `CLERK_WEBHOOK_SIGNING_SECRET`    | Clerk webhook verification                   |
| tpx-auth        | `CONVEX_DEPLOY_KEY`               | Convex HTTP API                              |
| tpx-connections | `CONVEX_DEPLOY_KEY`               | Convex HTTP API                              |
| tpx-connections | `CONNECTIONS_MASTER_KEY`          | wraps every secret's data key (base64, 32 B) |
| tpx-connections | `CONNECTIONS_MASTER_KEY_PREVIOUS` | optional, during master key rotation         |

Generate a master key with `openssl rand -base64 32`.

## Deploy

```sh
pnpm -r deploy:dry-run      # what CI runs
pnpm --filter @tpx/auth-service deploy
pnpm --filter @tpx/connections-service deploy
pnpm --filter @tpx/web deploy
```

Deploy services before tpx-web the first time so the service bindings resolve. `env.staging` in each wrangler config gives you `*-staging` Workers (`wrangler deploy --env staging`).

## Local development

- `pnpm dev:fixture` — fixture identity, in-memory stores, preview products on. No external services.
- `pnpm dev` — real Clerk (keys in `apps/web/.dev.vars`) and real Convex (`CONVEX_URL` / `CONVEX_DEPLOY_KEY` in each service's `.dev.vars`).
