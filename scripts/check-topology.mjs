#!/usr/bin/env node
// Boundary rule 4: one Worker.
//
// The console is a single Worker (apps/web) that mounts every service
// in-process, so the topology is: exactly one Wrangler config in the
// repository, at apps/web; no `services` (service binding) entries in it,
// top-level or in any `env.*` block; and nothing under services/ that is a
// Worker of its own. Services are libraries the Worker entry constructs with
// its env — this check keeps the repository from drifting back to one
// Worker per service without a deliberate change here.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readJsonc } from "./jsonc.mjs";

const root = process.cwd();
const WEB_CONFIG = "apps/web/wrangler.jsonc";
const CONFIG_RE = /^wrangler\.(jsonc?|toml)$/;
const failures = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "build" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (CONFIG_RE.test(entry)) out.push(relative(root, full));
  }
  return out;
}

const configs = walk(root);
if (!configs.includes(WEB_CONFIG)) failures.push(`${WEB_CONFIG} is missing`);
for (const config of configs) {
  if (config === WEB_CONFIG) continue;
  failures.push(`${config}: a second Worker config (the console is one Worker; services are libraries it mounts)`);
}

function inspect(label, cfg) {
  if ("services" in cfg)
    failures.push(`${label}: declares service bindings — services are mounted in-process, not bound`);
}

if (configs.includes(WEB_CONFIG)) {
  const cfg = readJsonc(join(root, WEB_CONFIG));
  inspect(WEB_CONFIG, cfg);
  for (const [envName, envCfg] of Object.entries(cfg.env ?? {})) inspect(`${WEB_CONFIG} [env.${envName}]`, envCfg);
}

if (failures.length > 0) {
  console.error("Topology check failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("Topology check passed: one Worker, no service bindings.");
