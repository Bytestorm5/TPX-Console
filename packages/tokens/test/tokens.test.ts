import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, cssVarName, palette, themes, type ThemeColors } from "../src/index.ts";

const css = readFileSync(join(import.meta.dirname, "../src/tokens.css"), "utf8");

function block(selectorStart: string): string {
  const start = css.indexOf(selectorStart);
  expect(start, `selector ${selectorStart} present`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced block");
}

/** Hex colours compare case-insensitively: the JS mirror keeps the brand kit's upper case, Prettier lowercases CSS. */
function declared(blockText: string, name: string): string | undefined {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(blockText);
  return m?.[1]?.trim().toLowerCase();
}

const hex = (value: string) => value.toLowerCase();

describe("tokens.css mirrors index.ts", () => {
  const light = block(":root {");
  const pinnedDark = block(':root[data-theme="dark"]');
  const preferredDark = block(':root:not([data-theme="light"])');

  it("declares the brand palette verbatim", () => {
    expect(declared(light, "--tpx-violet")).toBe(hex(palette.violet));
    expect(declared(light, "--tpx-bayside-blue")).toBe(hex(palette.baysideBlue));
    expect(declared(light, "--tpx-blue")).toBe(hex(palette.blue));
    expect(declared(light, "--tpx-ebony-black")).toBe(hex(palette.ebonyBlack));
    expect(declared(light, "--tpx-cloud")).toBe(hex(palette.cloud));
  });

  it.each(Object.keys(themes.light) as (keyof ThemeColors)[])("keeps %s in sync in every theme", (name) => {
    expect(declared(light, cssVarName[name])).toBe(hex(themes.light[name]));
    expect(declared(pinnedDark, cssVarName[name])).toBe(hex(themes.dark[name]));
    expect(declared(preferredDark, cssVarName[name])).toBe(hex(themes.dark[name]));
  });
});

describe("contrast floors (WCAG 4.5:1 for text)", () => {
  for (const theme of ["light", "dark"] as const) {
    const t = themes[theme];
    it(`${theme}: ink on surface`, () => expect(contrastRatio(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5));
    it(`${theme}: ink on raised surface`, () =>
      expect(contrastRatio(t.ink, t.surfaceRaised)).toBeGreaterThanOrEqual(4.5));
    it(`${theme}: muted ink on surface`, () =>
      expect(contrastRatio(t.inkMuted, t.surface)).toBeGreaterThanOrEqual(4.5));
    it(`${theme}: label on accent`, () => expect(contrastRatio(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5));
    it(`${theme}: status colours are legible on surface`, () => {
      expect(contrastRatio(t.success, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.warning, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.danger, t.surface)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
