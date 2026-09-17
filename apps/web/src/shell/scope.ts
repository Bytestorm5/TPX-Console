/** Scoped URL building — pure, shared by server and client code. */
export function scopePath(projectSlug: string, environmentName: string, rest = ""): string {
  const tail = rest ? (rest.startsWith("/") ? rest : `/${rest}`) : "";
  return `/${projectSlug}/${environmentName}${tail}`;
}
