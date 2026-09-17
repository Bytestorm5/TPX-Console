/**
 * The Alfiz Application (org root) and a catalog-typed client over it, one
 * per store. `ready` seeds the roles and publishes the catalog once.
 */
import { createAlfizClient } from "@alfiz/core";
import { createApplication, type AlfizApplication } from "@alfiz/application";
import { catalog, ensureSeedRoles, SEED_PROVENANCE, type TpxClient } from "@tpx/identity";
import { storeAncestry } from "./ancestry.ts";
import type { AuthStore } from "./store/types.ts";

export interface AlfizRuntime {
  app: AlfizApplication<string, string>;
  client: TpxClient;
  store: AuthStore;
  ready: Promise<void>;
}

const runtimes = new WeakMap<AuthStore, AlfizRuntime>();

export function getAlfiz(store: AuthStore): AlfizRuntime {
  const existing = runtimes.get(store);
  if (existing) return existing;
  const app = createApplication({
    catalog,
    storage: store.alfiz,
    ancestry: storeAncestry(store.tenancy),
    events: { persist: true },
  });
  const client = createAlfizClient({ catalog, provider: app });
  const ready = (async () => {
    await ensureSeedRoles(app);
    if ((await app.getPublishedCatalog()) === null) {
      await app.publishCatalog(catalog.toDocument(), SEED_PROVENANCE);
    }
  })();
  const runtime: AlfizRuntime = { app, client, store, ready };
  runtimes.set(store, runtime);
  // A failed boot must not be cached: the next call retries from scratch.
  ready.catch(() => {
    if (runtimes.get(store) === runtime) runtimes.delete(store);
  });
  return runtime;
}
