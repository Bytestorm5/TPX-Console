export function newId(prefix: "con" | "att" | "sec" | "aud"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 22)}`;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "connection";
}
