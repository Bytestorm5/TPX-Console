/**
 * The only coupling between the shell and the products: each product exports
 * one manifest, and this file imports them. The shell knows nothing else.
 */
import type { ProductManifest } from "./shell/manifest.ts";
import connections from "./products/connections/manifest.ts";
import dispatcher from "./products/dispatcher/manifest.ts";
import integrator from "./products/integrator/manifest.ts";
import operator from "./products/operator/manifest.ts";

export const products: readonly ProductManifest[] = [connections, operator, dispatcher, integrator];
