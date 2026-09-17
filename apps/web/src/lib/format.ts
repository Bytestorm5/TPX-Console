export function formatWhen(epochMs: number): string {
  return new Date(epochMs).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function maskHint(hint: string | undefined): string {
  return hint ? `••••${hint}` : "••••••••";
}
