// @ts-check
/**
 * Lint = the four boundary rules from the structure doc, mechanically:
 *   1. no cross-product imports (apps/web/src/products/<p> stays inside itself + shell/lib/@tpx)
 *   2. no service-to-service imports, no Worker entrypoints (services/<s> never imports another
 *      service, an app, or `cloudflare:workers` — a service is a library the Worker constructs)
 *   3. no raw hex/px in products or the shell — tokens only
 *   4. (one Worker — a single wrangler config, no service bindings — is checked by scripts/check-topology.mjs)
 * plus the usual TypeScript and hooks hygiene.
 */
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));

function productOf(file) {
  const rel = relative(resolve(root, "apps/web/src/products"), file);
  return rel.startsWith("..") ? null : rel.split(sep)[0];
}
function serviceOf(file) {
  const rel = relative(resolve(root, "services"), file);
  return rel.startsWith("..") ? null : rel.split(sep)[0];
}

/** @type {import("eslint").Rule.RuleModule} */
const boundaries = {
  meta: { type: "problem", docs: { description: "Product and service import boundaries" }, schema: [] },
  create(context) {
    const file = context.filename;
    const product = productOf(file);
    const service = serviceOf(file);
    if (!product && !service) return {};
    function check(node, spec) {
      if (typeof spec !== "string") return;
      if (product) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const other = productOf(target);
          if (other && other !== product)
            context.report({
              node,
              message: `Cross-product import: "${spec}" (product "${product}" may not import "${other}")`,
            });
          if (serviceOf(target)) context.report({ node, message: `Product imports a service: "${spec}"` });
          if (!other && relative(resolve(root, "apps/web/src"), target).startsWith(".."))
            context.report({ node, message: `Import escapes apps/web/src: "${spec}"` });
        } else if (spec.startsWith("~/")) {
          if (!(spec.startsWith("~/shell/") || spec.startsWith("~/lib/") || spec.startsWith(`~/products/${product}/`)))
            context.report({ node, message: `Products may only import ~/shell, ~/lib or their own files: "${spec}"` });
        } else if (spec.startsWith("@tpx/")) {
          const ok =
            ["@tpx/ui", "@tpx/tokens", "@tpx/identity"].some((p) => spec === p || spec.startsWith(`${p}/`)) ||
            spec === "@tpx/contracts" ||
            spec === `@tpx/contracts/${product}`;
          if (!ok) context.report({ node, message: `Not an allowed @tpx import for product "${product}": "${spec}"` });
        }
      }
      if (service) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const other = serviceOf(target);
          if (other && other !== service) context.report({ node, message: `Service-to-service import: "${spec}"` });
          if (!relative(resolve(root, "apps"), target).startsWith(".."))
            context.report({ node, message: `Service imports an app: "${spec}"` });
        } else if (
          spec === "@tpx/web" ||
          spec.startsWith("@tpx/web/") ||
          /^@tpx\/(auth|connections|operator|dispatcher|integrator)-service/.test(spec)
        ) {
          context.report({ node, message: `Service may not import "${spec}"` });
        } else if (spec === "cloudflare:workers") {
          context.report({
            node,
            message: "A service is a library the Worker constructs with its env, not a Worker entrypoint",
          });
        }
      }
    }
    return {
      ImportDeclaration: (n) => check(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && check(n, n.source.value),
      ExportAllDeclaration: (n) => check(n, n.source.value),
      ImportExpression: (n) => n.source.type === "Literal" && check(n, n.source.value),
    };
  },
};

const RAW_ARBITRARY = /\[[^\]]*(?:\d+(?:\.\d+)?px|#[0-9a-f]{3,8})[^\]]*\]/i;
const RAW_HEX = /#[0-9a-f]{6}\b/i;

/** @type {import("eslint").Rule.RuleModule} */
const noRawDesignValues = {
  meta: {
    type: "problem",
    docs: { description: "Tokens only: no raw hex colors or pixel values in UI code" },
    schema: [],
  },
  create(context) {
    function scan(node, text) {
      if (RAW_ARBITRARY.test(text))
        context.report({
          node,
          message: `Raw value in a class name: "${text.match(RAW_ARBITRARY)?.[0]}" — use a token utility`,
        });
      else if (RAW_HEX.test(text))
        context.report({ node, message: `Raw hex color "${text.match(RAW_HEX)?.[0]}" — use a token` });
    }
    return {
      Literal: (n) => typeof n.value === "string" && scan(n, n.value),
      TemplateElement: (n) => scan(n, n.value.raw),
      JSXAttribute: (n) => {
        if (n.name.name === "style" && n.value?.type === "JSXExpressionContainer")
          context.report({ node: n, message: "Inline style objects bypass the design tokens; use utilities" });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-dry-run/**",
      "**/build/**",
      "**/.react-router/**",
      "**/.wrangler/**",
      "**/worker-configuration.d.ts",
      "**/convex/_generated/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.serviceworker } },
    plugins: { tpx: { rules: { boundaries, "no-raw-design-values": noRawDesignValues } } },
    rules: {
      "tpx/boundaries": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/shell/components/Logo.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules, "tpx/no-raw-design-values": "error" },
  },
);
