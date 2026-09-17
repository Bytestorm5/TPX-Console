#!/usr/bin/env node
// Boundary rule 4: no public routes on service Workers.
//
// A Worker with no `routes` has no public URL ONLY if `workers_dev` and
// `preview_urls` are also off; Wrangler defaults both to on, which would give
// every service a `<name>.<account>.workers.dev` hostname. So this check
// requires the topology to be committed explicitly, for the top-level config
// and for every `env.*` block.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJsonc } from "./jsonc.mjs";

const servicesDir = join(process.cwd(), "services");
const failures = [];

function inspect(label, cfg) {
  if ("routes" in cfg) failures.push(`${label}: has a "routes" key`);
  if ("route" in cfg) failures.push(`${label}: has a "route" key`);
  if (cfg.workers_dev !== false) failures.push(`${label}: "workers_dev" must be false`);
  if (cfg.preview_urls !== false) failures.push(`${label}: "preview_urls" must be false`);
  if ("assets" in cfg) failures.push(`${label}: service Workers must not serve assets`);
}

for (const name of readdirSync(servicesDir)) {
  const path = join(servicesDir, name, "wrangler.jsonc");
  if (!existsSync(path)) {
    failures.push(`services/${name}: missing wrangler.jsonc`);
    continue;
  }
  const cfg = readJsonc(path);
  inspect(`services/${name}`, cfg);
  for (const [envName, envCfg] of Object.entries(cfg.env ?? {})) {
    inspect(`services/${name} [env.${envName}]`, envCfg);
  }
}

if (failures.length > 0) {
  console.error("Service route check failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Service route check passed: no service Worker exposes a public URL.");
