/**
 * Resolution is innermost-first and stops at the first level that supplies a
 * value:
 *
 *   1. binding                — this project, this environment
 *   2. attachment             — this project, all environments
 *   3. connection environment — this tenant, environments named like this one
 *   4. connection base        — this tenant, anything without a named default
 *
 * Pure: it works on config maps and secret metadata, never on secret values.
 * Execution uses `pickSecretRows` with the same order to choose which
 * ciphertext to open.
 */
import type { ProviderDescriptor, ResolutionLevel, ResolvedField } from "@tpx/contracts/connections";

export interface SecretMeta {
  hint: string;
  updatedAt: number;
}

export interface LevelValues {
  config: Record<string, string>;
  secrets: Map<string, SecretMeta>;
}

export interface ResolutionLevels {
  base: LevelValues;
  environmentDefault: LevelValues | null;
  attachment: LevelValues | null;
  binding: LevelValues | null;
}

export const LEVEL_ORDER: readonly ResolutionLevel[] = [
  "binding",
  "attachment",
  "connection-environment",
  "connection-base",
];

function levelValues(levels: ResolutionLevels, level: ResolutionLevel): LevelValues | null {
  switch (level) {
    case "binding":
      return levels.binding;
    case "attachment":
      return levels.attachment;
    case "connection-environment":
      return levels.environmentDefault;
    case "connection-base":
      return levels.base;
  }
}

export function resolveFields(descriptor: ProviderDescriptor, levels: ResolutionLevels): ResolvedField[] {
  const fields: ResolvedField[] = [];
  for (const spec of [...descriptor.configFields, ...descriptor.credentialFields]) {
    let resolved: ResolvedField = {
      key: spec.key,
      label: spec.label,
      secret: spec.secret,
      required: spec.required,
      set: false,
      suppliedBy: null,
    };
    for (const level of LEVEL_ORDER) {
      const values = levelValues(levels, level);
      if (!values) continue;
      if (spec.secret) {
        const meta = values.secrets.get(spec.key);
        if (meta) {
          resolved = { ...resolved, set: true, suppliedBy: level, ...(meta.hint ? { hint: meta.hint } : {}) };
          break;
        }
      } else {
        const value = values.config[spec.key];
        if (value !== undefined && value !== "") {
          resolved = { ...resolved, set: true, suppliedBy: level, value };
          break;
        }
      }
    }
    fields.push(resolved);
  }
  return fields;
}

export function missingRequired(fields: readonly ResolvedField[]): string[] {
  return fields.filter((f) => f.required && !f.set).map((f) => f.key);
}

/** Innermost-first choice of a row per key, for any row type that names its key. */
export function pickInnermost<T extends { key: string }>(
  rowsByLevel: Partial<Record<ResolutionLevel, readonly T[]>>,
): Map<string, { row: T; level: ResolutionLevel }> {
  const chosen = new Map<string, { row: T; level: ResolutionLevel }>();
  for (const level of LEVEL_ORDER) {
    for (const row of rowsByLevel[level] ?? []) {
      if (!chosen.has(row.key)) chosen.set(row.key, { row, level });
    }
  }
  return chosen;
}
