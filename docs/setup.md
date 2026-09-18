# Setup

One Worker, so one place for everything: vars in `apps/web/wrangler.jsonc`, secrets in the dashboard (or `apps/web/.dev.vars` locally), one deploy. Every service reads its slice of the same env.

## Clerk

1. Create a Clerk application. Organizations are **not** needed: Clerk only signs users in; tenants, membership and invitations are the console's own (the auth service on Alfiz).
2. The Worker needs `CLERK_PUBLISHABLE_KEY` (a var in `apps/web/wrangler.jsonc`, or the dashboard) and the secrets `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` (`wrangler secret put`, or `.dev.vars` locally — see `apps/web/.dev.vars.example`).
3. Point a webhook at `https://<console>/webhooks/clerk` for the `user.deleted` event so a deleted account loses its memberships at once.

## Convex

One deployment for the whole console, defined in `packages/convex` (each service's functions in its own folder, its tables prefixed `auth_` / `connections_`):

```sh
cd packages/convex && npx convex dev        # creates the deployment, pushes the schema and functions, runs codegen
```

Then give the Worker `CONVEX_URL` (a var in `apps/web/wrangler.jsonc`) and `CONVEX_DEPLOY_KEY` (a secret); every service reads the same pair. `packages/convex/convex/_generated` is committed so the repository typechecks without a deployment; `npx convex dev` regenerates it.

## Secrets

All on the one Worker (`tpx-web`, or `tpx-web-staging` for `env.staging`):

| Secret                            | Needed by               | Purpose                                      |
| --------------------------------- | ----------------------- | -------------------------------------------- |
| `CLERK_SECRET_KEY`                | the shell               | Clerk session verification                   |
| `CLERK_WEBHOOK_SIGNING_SECRET`    | the shell               | Clerk webhook verification                   |
| `CONVEX_DEPLOY_KEY`               | every service           | Convex HTTP API                              |
| `CONNECTIONS_MASTER_KEY`          | the connections service | wraps every secret's data key (base64, 32 B) |
| `CONNECTIONS_MASTER_KEY_PREVIOUS` | the connections service | optional, during master key rotation         |

Generate a master key with `openssl rand -base64 32`.

## Deploy

```sh
pnpm --filter @tpx/web deploy:dry-run   # what CI runs
pnpm --filter @tpx/web deploy
```

One Worker, one deploy: the services ship inside it, so there is no ordering to get right. `env.staging` in `apps/web/wrangler.jsonc` gives you `tpx-web-staging` (`wrangler deploy --env staging`).

## Local development

- `pnpm dev:fixture` — fixture identity, in-memory stores, preview products on. No external services.
- `pnpm dev` — real Clerk and real Convex: `CLERK_*`, `CONVEX_DEPLOY_KEY` and `CONNECTIONS_MASTER_KEY` in `apps/web/.dev.vars`, `CONVEX_URL` from `apps/web/wrangler.jsonc`.
