/**
 * The read-only Alfiz provider tpx-web attaches its client to. Closure supply
 * and ancestry come from tpx-auth over the service binding; every write is
 * refused, because writes go through the AuthService's own audited methods.
 *
 * Runtime checks still never leave tpx-web: the client evaluates locally over
 * the closure data this provider fetches, and caches it with epoch
 * revalidation against tpx-auth's persisted event log.
 */
import { AlfizProviderBase, ProviderWriteRejectedError, createAlfizClient } from "@alfiz/core";
import type { AncestryResolver, EpochSource, PrincipalRef, ProviderCapabilities, SubjectAccessData } from "@alfiz/core";
import type { AuthProviderSeam } from "@tpx/contracts/auth";
import { catalog as tpxCatalog, type TpxClient } from "./catalog.ts";

const READ_ONLY = "tpx-web holds a read-only view of tpx-auth; writes go through the AuthService RPC";

export class RemoteAuthProvider extends AlfizProviderBase {
  override readonly resolveAncestors: AncestryResolver;
  override readonly epoch: EpochSource;
  readonly #seam: AuthProviderSeam;

  constructor(seam: AuthProviderSeam) {
    super();
    this.#seam = seam;
    this.resolveAncestors = (scope) => seam.resolveAncestors(scope);
    this.epoch = {
      head: () => seam.epochHead(),
      since: (seq, limit) => seam.epochSince(seq, limit),
    };
  }

  override async capabilities(): Promise<ProviderCapabilities> {
    return {
      orgRoot: false,
      requests: false,
      reporting: false,
      audit: false,
      multiParent: false,
      metrics: false,
      imports: false,
      mesh: false,
    };
  }

  override async getSubjectAccess(principal: PrincipalRef): Promise<SubjectAccessData> {
    return this.#seam.getSubjectAccess(principal) as unknown as SubjectAccessData;
  }

  #readOnly(): never {
    throw new ProviderWriteRejectedError(READ_ONLY, "unsupported");
  }

  override async createGrant(): Promise<never> {
    return this.#readOnly();
  }
  override async createGrants(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteGrant(): Promise<never> {
    return this.#readOnly();
  }
  override async listGrants(): Promise<never> {
    return this.#readOnly();
  }
  override async countGrants(): Promise<never> {
    return this.#readOnly();
  }
  override async createRevoke(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteRevoke(): Promise<never> {
    return this.#readOnly();
  }
  override async listRevokes(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteSubject(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteScope(): Promise<never> {
    return this.#readOnly();
  }
  override async submitRequest(): Promise<never> {
    return this.#readOnly();
  }
  override async decideRequest(): Promise<never> {
    return this.#readOnly();
  }
  override async cancelRequest(): Promise<never> {
    return this.#readOnly();
  }
  override async listRequests(): Promise<never> {
    return this.#readOnly();
  }
  override async listApproverQueue(): Promise<never> {
    return this.#readOnly();
  }
  override async publishCatalog(): Promise<never> {
    return this.#readOnly();
  }
  override async getPublishedCatalog(): Promise<never> {
    return this.#readOnly();
  }
  override async listRoles(): Promise<never> {
    return this.#readOnly();
  }
  override async createRole(): Promise<never> {
    return this.#readOnly();
  }
  override async updateRole(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteRole(): Promise<never> {
    return this.#readOnly();
  }
  override async listGroups(): Promise<never> {
    return this.#readOnly();
  }
  override async createGroup(): Promise<never> {
    return this.#readOnly();
  }
  override async updateGroup(): Promise<never> {
    return this.#readOnly();
  }
  override async setGroupParents(): Promise<never> {
    return this.#readOnly();
  }
  override async deleteGroup(): Promise<never> {
    return this.#readOnly();
  }
  override async setGroupMembership(): Promise<never> {
    return this.#readOnly();
  }
  override async getGroupMembers(): Promise<never> {
    return this.#readOnly();
  }
  override async setUserActive(): Promise<never> {
    return this.#readOnly();
  }
  override async setReportingEdge(): Promise<never> {
    return this.#readOnly();
  }
  override async getReportingEdges(): Promise<never> {
    return this.#readOnly();
  }
  override async dissolveVirtualParent(): Promise<never> {
    return this.#readOnly();
  }
  override async listAuditEvents(): Promise<never> {
    return this.#readOnly();
  }
}

export interface TpxClientOptions {
  /** Epoch revalidation window in ms (default 5 000); `false` for TTL-only caching. */
  revalidateAfterMs?: number | false;
  /** The incident switch: every check bypasses caches. */
  strict?: boolean;
}

/** A catalog-typed Alfiz client over the remote seam — one per isolate in tpx-web. */
export function createTpxClient(seam: AuthProviderSeam, options: TpxClientOptions = {}): TpxClient {
  return createAlfizClient({
    catalog: tpxCatalog,
    provider: new RemoteAuthProvider(seam),
    ...(options.revalidateAfterMs !== undefined ? { revalidateAfterMs: options.revalidateAfterMs } : {}),
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
  });
}
