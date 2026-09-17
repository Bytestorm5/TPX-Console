# Security notes

## Secrets

- Credential values are **write-only** through the console: forms post them once, the connections Worker encrypts them, and every read model (`Connection`, `Attachment`, `Binding`, `Resolution`) carries only `{ set, hint, updatedAt }`, where the hint is the last four characters of values eight characters or longer.
- **Envelope encryption** in the Worker (WebCrypto, AES-256-GCM): a random data key per secret, wrapped by the master key in `CONNECTIONS_MASTER_KEY` (base64, 32 bytes). `CONNECTIONS_MASTER_KEY_PREVIOUS` lets you rotate: set the new key as current, the old as previous, and re-save secrets over time; `keyVersion` on each row says which key wrapped it.
- The AAD binds ciphertext to its owner (`tenantId`, owner kind, owner id, environment key, field key), so a row copied between tenants or fields does not decrypt.
- Convex only ever stores ciphertext; the deploy key is a Worker secret.
- Revealing a secret needs `tpx.connections.connections.reveal_secret` — grantable **only at the tenant** — and is audited with the user, the field and the level. The action response is `Cache-Control: no-store` and the value is rendered once from the action result, never from loader data.

## Authorization

- The catalog (`packages/identity/src/catalog.ts`) declares where each key may be granted. Creating connections, rotating or revealing credentials, deleting, managing grants and changing the vocabulary are tenant-only; Alfiz's `appliesAt` makes a project-scoped grant unable to confer them, by construction.
- Seed roles: `tpx-owner` (`tpx.*`), `tpx-admin` (everything non-destructive minus reveal), `tpx-member` (reads, attachments, bindings, usage, product actions), `tpx-viewer` (reads). The last owner of a tenant cannot be removed.
- Clerk `org:admin` is mirrored into a `tpx-admin` grant with provenance `clerk:org:admin`, and demoted with the Clerk role; the mirror is memoised for one minute per user × org × role.
- tpx-auth re-checks with `can.fresh` (no cache) before deleting a project, changing the vocabulary or managing grants.
- The forwarder resolves the scope from `x-tpx-project` / `x-tpx-environment` and refuses before any service sees the request; services still verify every grant on the `Ctx` they receive.

## Transport and headers

- Services have no public URL: `workers_dev: false`, `preview_urls: false`, no routes (CI-enforced).
- Responses set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Robots-Tag: noindex`.
- The remembered-scope cookie is `HttpOnly; Secure; SameSite=Lax`.
- Clerk webhooks are verified with the signing secret (`CLERK_WEBHOOK_SIGNING_SECRET`).

## Known gaps

- Deleting a project does not yet cascade into the connections service (attachments and bindings of that project remain until the connection is deleted or detached).
- Audit export (`export_audit`) is declared in the catalog but has no UI yet.
