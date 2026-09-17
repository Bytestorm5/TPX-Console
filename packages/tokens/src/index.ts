/**
 * Trusplex design tokens — the JS mirror of `tokens.css`.
 *
 * `tokens.css` is the source consumed by the frontend; this module exists for
 * the places CSS custom properties cannot reach (Clerk's `appearance.variables`,
 * chart palettes, generated SVG). `test/tokens.test.ts` keeps the two in sync.
 *
 * Every value here comes from the Trusplex design system (tokens.json v1)
 * except the entries under `consoleAdditions`, which are deliberate console
 * extensions: the brand kit is an identity guide and defines no status colours
 * or sunken surface, so they are declared here once rather than invented per
 * product (boundary rule 3).
 */

export const palette = {
  violet: "#746DF8",
  baysideBlue: "#1C83EA",
  blue: "#0039D8",
  ebonyBlack: "#0B0B1B",
  white: "#FFFFFF",
  graphite: "#6E7180",
  space: "#9DA2B3",
  steel: "#BCBFCC",
  smoke: "#D3D6E0",
  cloud: "#EDEFF7",
} as const;

export interface ThemeColors {
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  ink: string;
  inkMuted: string;
  borderDefault: string;
  borderSubtle: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  focusRing: string;
}

export const themes: Readonly<Record<"light" | "dark", ThemeColors>> = {
  light: {
    surface: palette.white,
    surfaceRaised: palette.cloud,
    surfaceSunken: "#F6F7FB",
    ink: palette.ebonyBlack,
    inkMuted: palette.graphite,
    borderDefault: palette.steel,
    borderSubtle: palette.smoke,
    accent: palette.blue,
    onAccent: palette.white,
    accentSoft: "#E6ECFF",
    success: "#1B7F4C",
    warning: "#9A6200",
    danger: "#B3261E",
    focusRing: palette.baysideBlue,
  },
  dark: {
    surface: palette.ebonyBlack,
    surfaceRaised: "#14142A",
    surfaceSunken: "#070712",
    ink: palette.white,
    inkMuted: palette.space,
    borderDefault: palette.graphite,
    borderSubtle: "#2A2B45",
    accent: palette.baysideBlue,
    // The kit pairs white on bayside-blue only at bold ≥19px labels (~3.8:1).
    // Console buttons are 14–16px, so the dark theme labels the accent fill in
    // ink (~5.1:1) exactly as the Trusplex colour guidance prescribes.
    onAccent: palette.ebonyBlack,
    accentSoft: "#14243F",
    success: "#4CC38A",
    warning: "#E8B13E",
    danger: "#FF6B6B",
    focusRing: palette.baysideBlue,
  },
};

/** The names of the tokens that are console additions rather than brand-kit values. */
export const consoleAdditions = [
  "surfaceSunken",
  "accentSoft",
  "success",
  "warning",
  "danger",
  "focusRing",
] as const satisfies readonly (keyof ThemeColors)[];

export const spacing = { 1: "8px", 2: "16px", 3: "24px", 4: "40px" } as const;
export const radius = { sm: "8px", md: "16px", lg: "24px", full: "9999px" } as const;
export const fontFamily = {
  sans: '"Geist", system-ui, -apple-system, sans-serif',
  mono: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;
export const brandGradient = "linear-gradient(135deg, #746DF8 0%, #1C83EA 50%, #0039D8 100%)";

/** `--tpx-<name>` custom property names, as written in tokens.css. */
export const cssVarName = {
  surface: "--tpx-surface",
  surfaceRaised: "--tpx-surface-raised",
  surfaceSunken: "--tpx-surface-sunken",
  ink: "--tpx-ink",
  inkMuted: "--tpx-ink-muted",
  borderDefault: "--tpx-border-default",
  borderSubtle: "--tpx-border-subtle",
  accent: "--tpx-accent",
  onAccent: "--tpx-on-accent",
  accentSoft: "--tpx-accent-soft",
  success: "--tpx-success",
  warning: "--tpx-warning",
  danger: "--tpx-danger",
  focusRing: "--tpx-focus-ring",
} as const satisfies Record<keyof ThemeColors, string>;

export function cssVar(name: keyof ThemeColors): string {
  return `var(${cssVarName[name]})`;
}

/** Relative luminance per WCAG 2.x, for the contrast checks in tests and tooling. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const channel = (i: number) => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
