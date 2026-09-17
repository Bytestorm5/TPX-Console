/** Flattens FormData into a string map (first value wins; files are ignored). */
export function formValues(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !(key in out)) out[key] = value;
  }
  return out;
}

/** Fields named `prefix:key` → `{ key: value }`, skipping blanks unless `keepBlank`. */
export function prefixed(values: Record<string, string>, prefix: string, keepBlank = false): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(`${prefix}:`)) continue;
    if (value === "" && !keepBlank) continue;
    out[key.slice(prefix.length + 1)] = value;
  }
  return out;
}
