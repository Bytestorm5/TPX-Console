/** What ingress resolves from the identity provider before anything else runs. */
export interface SessionIdentity {
  userId: string;
  /** The active organization — the tenant. `null` when the user has not activated one. */
  orgId: string | null;
  orgRole: string | null;
  /** Display data for the shell; never used for authorization. */
  displayName: string | null;
  email: string | null;
  imageUrl: string | null;
}

/** The default tenant name for a brand-new user. */
export function defaultTenantName(identity: { displayName: string | null; email: string | null }): string {
  const base = identity.displayName?.trim() || identity.email?.split("@")[0]?.trim() || "My";
  const first = base.split(/\s+/)[0] ?? base;
  return `${first}'s Org`;
}
