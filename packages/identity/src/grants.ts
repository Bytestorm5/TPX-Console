/**
 * From an Alfiz snapshot to the `grants` a `Ctx` carries, and the pure checks
 * services run against them.
 *
 * `grantsAt` asks the snapshot every catalog key at ONE scope — the request's
 * innermost scope — so a service can enforce with a set lookup and never needs
 * the provider. This is what lets services trust the context they receive:
 * the only scope a product can pass inward is the one the shell handed it,
 * and the grants were computed for exactly that scope.
 */
import type { LooseScopeId } from "@alfiz/core";
import { catalog as tpxCatalog, type TpxKey } from "./catalog.ts";
import { ForbiddenError } from "./errors.ts";

export interface CanSnapshot {
  can(key: TpxKey | readonly TpxKey[], scope?: LooseScopeId<string>): boolean;
}

export function grantsAt(snapshot: CanSnapshot, scope: string): TpxKey[] {
  const held: TpxKey[] = [];
  for (const key of tpxCatalog.ownedKeys as TpxKey[]) {
    if (snapshot.can(key, scope)) held.push(key);
  }
  return held;
}

export interface HasGrants {
  grants: readonly string[];
}

export function hasGrant(ctx: HasGrants, key: TpxKey): boolean {
  return ctx.grants.includes(key);
}

export function hasAnyGrant(ctx: HasGrants, keys: readonly TpxKey[]): boolean {
  return keys.some((key) => ctx.grants.includes(key));
}

/** The enforcement point every service method starts with. */
export function requireGrant(ctx: HasGrants, key: TpxKey): void {
  if (!tpxCatalog.hasKey(key)) {
    // A key the catalog does not declare is a programming error, never a denial.
    throw new Error(`requireGrant: unknown permission ${JSON.stringify(key)}`);
  }
  if (!hasGrant(ctx, key)) {
    throw new ForbiddenError(`missing ${key}`, key);
  }
}

export function requireAnyGrant(ctx: HasGrants, keys: readonly TpxKey[]): void {
  for (const key of keys) {
    if (!tpxCatalog.hasKey(key)) throw new Error(`requireAnyGrant: unknown permission ${JSON.stringify(key)}`);
  }
  if (!hasAnyGrant(ctx, keys)) {
    throw new ForbiddenError(`missing one of ${keys.join(", ")}`, keys[0]);
  }
}

/** Nav filtering helper: does the visible product have anything the user can do? */
export function productsWithGrants(grants: readonly string[]): Set<string> {
  const products = new Set<string>();
  for (const key of grants) {
    const parts = key.split(".");
    if (parts[0] === "tpx" && parts[1]) products.add(parts[1]);
  }
  return products;
}
