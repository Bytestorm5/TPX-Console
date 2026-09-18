#!/usr/bin/env node
// Boundary rules 1 and 2, checked mechanically:
//
//   1. No cross-product imports. `apps/web/src/products/<p>/**` may import its
//      own files, `~/shell/**`, `~/lib/**`, `@tpx/ui`, `@tpx/tokens`,
//      `@tpx/identity`, `@tpx/contracts` and `@tpx/contracts/<p>`. Never
//      another product, never a service.
//   2. No service-to-service imports, and no Worker entrypoints. `services/<s>/**`
//      may not import from another service, from `apps/`, or from
//      `cloudflare:workers`: a service is a library the Worker entry
//      constructs with its env, never an entrypoint of its own. Shared logic
//      goes to `packages/`.
//
// Import specifiers are read syntactically (import/export ... from "x",
// dynamic import("x")); this is deliberately dependency-free so it runs in CI
// before anything is installed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";

const root = process.cwd();
const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "build" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(file) {
  const text = readFileSync(file, "utf8");
  const specs = [];
  for (const m of text.matchAll(IMPORT_RE)) specs.push(m[1] ?? m[2]);
  return specs;
}

function productOf(file) {
  const rel = relative(join(root, "apps/web/src/products"), file);
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0];
}

function serviceOf(file) {
  const rel = relative(join(root, "services"), file);
  if (rel.startsWith("..")) return null;
  return rel.split(sep)[0];
}

function resolveRelative(file, spec) {
  return resolve(dirname(file), spec);
}

function listDirs(dir) {
  try {
    return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  } catch {
    return [];
  }
}

// Rule 1 — products.
const productsDir = join(root, "apps/web/src/products");
const productNames = listDirs(productsDir);
for (const product of productNames) {
  for (const file of walk(join(productsDir, product))) {
    for (const spec of specifiersOf(file)) {
      const label = `${relative(root, file)} → "${spec}"`;
      if (spec.startsWith(".")) {
        const target = resolveRelative(file, spec);
        const targetProduct = productOf(target);
        if (targetProduct && targetProduct !== product) failures.push(`${label}: cross-product import`);
        if (serviceOf(target)) failures.push(`${label}: product imports a service`);
        if (!targetProduct && relative(join(root, "apps/web/src"), target).startsWith("..")) {
          failures.push(`${label}: escapes apps/web/src`);
        }
        continue;
      }
      if (spec.startsWith("~/")) {
        const ok =
          spec.startsWith("~/shell/") || spec.startsWith("~/lib/") || spec.startsWith(`~/products/${product}/`);
        if (!ok) failures.push(`${label}: products may only import ~/shell, ~/lib or their own files`);
        continue;
      }
      if (spec.startsWith("@tpx/")) {
        const ok =
          spec === "@tpx/ui" ||
          spec.startsWith("@tpx/ui/") ||
          spec === "@tpx/tokens" ||
          spec.startsWith("@tpx/tokens/") ||
          spec === "@tpx/identity" ||
          spec.startsWith("@tpx/identity/") ||
          spec === "@tpx/contracts" ||
          spec === `@tpx/contracts/${product}`;
        if (!ok) failures.push(`${label}: not an allowed @tpx import for product "${product}"`);
      }
    }
  }
}

// Rule 2 — services.
const servicesDir = join(root, "services");
const serviceNames = listDirs(servicesDir);
for (const service of serviceNames) {
  for (const file of walk(join(servicesDir, service))) {
    for (const spec of specifiersOf(file)) {
      const label = `${relative(root, file)} → "${spec}"`;
      if (spec.startsWith(".")) {
        const target = resolveRelative(file, spec);
        const targetService = serviceOf(target);
        if (targetService && targetService !== service) failures.push(`${label}: service-to-service import`);
        if (!relative(join(root, "apps"), target).startsWith("..")) failures.push(`${label}: service imports an app`);
        continue;
      }
      if (spec === "@tpx/web" || spec.startsWith("@tpx/web/")) failures.push(`${label}: service imports the web app`);
      if (/^@tpx\/(auth|connections|operator|dispatcher|integrator)-service/.test(spec)) {
        failures.push(`${label}: service-to-service import`);
      }
      if (spec === "cloudflare:workers") {
        failures.push(`${label}: a service is a library, not a Worker entrypoint (it is constructed with its env)`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Boundary check failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`Boundary check passed (${productNames.length} products, ${serviceNames.length} services).`);
