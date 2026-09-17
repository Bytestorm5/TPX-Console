import { createAlfizClient, parentPointerResolver } from "@alfiz/core";
import { createApplication, memoryDriver } from "@alfiz/application";
import { catalog } from "../src/catalog.ts";
import { ensureSeedRoles } from "../src/roles.ts";
import { environmentScope, projectScope, tenantScope } from "../src/scopes.ts";

/** An in-memory org root with a tenant/project/environment tree, for pure evaluation tests. */
export async function makeHarness() {
  const parents = new Map<string, string>();
  const addTenant = (t: string) => {
    parents.set(tenantScope(t), "*");
  };
  const addProject = (t: string, p: string) => {
    parents.set(projectScope(p), tenantScope(t));
  };
  const addEnvironment = (p: string, e: string) => {
    parents.set(environmentScope(e), projectScope(p));
  };
  const ancestry = parentPointerResolver((scope) => {
    const parent = parents.get(scope);
    if (parent === undefined) throw new Error(`unknown scope ${scope}`);
    return parent === "*" ? null : parent;
  });
  const app = createApplication({ catalog, storage: memoryDriver(), ancestry });
  await ensureSeedRoles(app);
  const client = createAlfizClient({ catalog, provider: app });
  return { app, client, addTenant, addProject, addEnvironment };
}

export const PROVENANCE = { kind: "system" as const, note: "test" };
