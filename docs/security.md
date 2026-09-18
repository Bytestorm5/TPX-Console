# Security notes

## Secrets

- Credential values are **write-only** through the console: forms post them once, the connections service encrypts them, and every read model (`Connection`, `Attachment`, `Binding`, `Resolution`) carries only `{ set, hint, updatedAt }`, where the hint is the last four characters of values eight characters or longer.
- **Envelope encryption** in the connections service (WebCrypto in the Worker, AES-256-GCM): a random data key per secret, wrapped by the master key in `CONNECTIONS_MASTER_KEY` (base64, 32 bytes). `CONNECTIONS_MASTER_KEY_PREVIOUS` lets you rotate: set the new key as current, the old as previous, and re-save secrets over time; `keyVersion` on each row says which key wrapped it.
- The AAD binds ciphertext to its owner (`tenantId`, owner kind, owner id, environment key, field key), so a row copied between tenants or fields does not decrypt.
- Convex only ever stores ciphertext. The deploy key and the master key are secrets of the one Worker; the connections service reads them from the env it is constructed with, and nothing else in the Worker touches them.
- Revealing a secret needs `tpx.connections.connections.reveal_secret` — grantable **only at the tenant** — and is audited with the user, the field and the level. The action response is `Cache-Control: no-store` and the value is rendered once from the action result, never from loader data.

## Authorization

- The catalog (`packages/identity/src/catalog.ts`) declares where each key may be granted. Creating connections, rotating or revealing credentials, deleting, managing grants and changing the vocabulary are tenant-only; Alfiz's `appliesAt` makes a project-scoped grant unable to confer them, by construction.
- Seed roles: `tpx-owner` (`tpx.*`), `tpx-admin` (everything non-destructive minus reveal), `tpx-member` (reads, attachments, bindings, usage, product actions), `tpx-viewer` (reads). The last owner of a tenant cannot be removed.
- Clerk `org:admin` is mirrored into a `tpx-admin` grant with provenance `clerk:org:admin`, and demoted with the Clerk role; the mirror is memoised for one minute per user × org × role.
- The auth service re-checks with `can.fresh` (no cache) before deleting a project, changing the vocabulary or managing grants.
- Every service method takes a `Ctx` and verifies the grant it needs on it, whether a loader called it or the `/api` forwarder did. The forwarder resolves the scope from `x-tpx-project` / `x-tpx-environment` and refuses before any service sees the request; being in the same Worker as the shell does not exempt a service from checking.

## Transport and headers

- Services have no network identity: they are libraries inside the one Worker, reachable only through the shell (a loader or action, or the `/api/<product>/*` forwarder once it has resolved the scope). The Worker has one route and `workers_dev` / `preview_urls` off; CI enforces that no second Worker config or service binding appears (`scripts/check-topology.mjs`), and lint that no service reaches for `cloudflare:workers`.
- Responses set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Robots-Tag: noindex`.
- The remembered-scope cookie is `HttpOnly; Secure; SameSite=Lax`.
- Clerk webhooks are verified with the signing secret (`CLERK_WEBHOOK_SIGNING_SECRET`).

## Known gaps

- Deleting a project does not yet cascade into the connections service (attachments and bindings of that project remain until the connection is deleted or detached).
- Audit export (`export_audit`) is declared in the catalog but has no UI yet.
