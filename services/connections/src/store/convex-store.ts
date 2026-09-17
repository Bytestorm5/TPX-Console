import { compact, voided, type ConvexCaller } from "@tpx/convex-client";
import { internal } from "../../convex/_generated/api";
import type {
  AttachmentRow,
  AuditRow,
  BindingRow,
  ConnectionRow,
  ConnectionsStore,
  EnvironmentDefaultRow,
  SecretRow,
} from "./types.ts";

export function convexStore(c: ConvexCaller): ConnectionsStore {
  return {
    listConnections: (tenantId) => c.query(internal.store.listConnections, { tenantId }) as Promise<ConnectionRow[]>,
    getConnection: (tenantId, connectionId) =>
      c.query(internal.store.getConnection, { tenantId, connectionId }) as Promise<ConnectionRow | null>,
    insertConnection: (row) => voided(c.mutation(internal.store.insertConnection, { row })),
    updateConnection: (tenantId, connectionId, patch) =>
      voided(c.mutation(internal.store.updateConnection, { tenantId, connectionId, patch: compact(patch) })),
    deleteConnection: (tenantId, connectionId) =>
      voided(c.mutation(internal.store.deleteConnection, { tenantId, connectionId })),

    listEnvironmentDefaults: (tenantId, connectionId) =>
      c.query(internal.store.listEnvironmentDefaults, { tenantId, connectionId }) as Promise<EnvironmentDefaultRow[]>,
    upsertEnvironmentDefault: (row) => voided(c.mutation(internal.store.upsertEnvironmentDefault, { row })),

    listSecrets: (tenantId, owners) =>
      c.query(internal.store.listSecrets, { tenantId, owners }) as Promise<SecretRow[]>,
    upsertSecret: (row) => voided(c.mutation(internal.store.upsertSecret, { row })),
    deleteSecret: (tenantId, owner, key) => voided(c.mutation(internal.store.deleteSecret, { tenantId, owner, key })),
    deleteSecretsForOwner: (tenantId, owner) =>
      voided(c.mutation(internal.store.deleteSecretsForOwner, { tenantId, owner })),

    listAttachments: (tenantId, projectId) =>
      c.query(internal.store.listAttachments, { tenantId, projectId }) as Promise<AttachmentRow[]>,
    getAttachment: (tenantId, attachmentId) =>
      c.query(internal.store.getAttachment, { tenantId, attachmentId }) as Promise<AttachmentRow | null>,
    listAttachmentsForConnection: (tenantId, connectionId) =>
      c.query(internal.store.listAttachmentsForConnection, { tenantId, connectionId }) as Promise<AttachmentRow[]>,
    insertAttachment: (row) => c.mutation(internal.store.insertAttachment, { row }),
    updateAttachment: (tenantId, attachmentId, patch) =>
      voided(c.mutation(internal.store.updateAttachment, { tenantId, attachmentId, patch: compact(patch) })),
    setDefaultAttachment: (tenantId, projectId, capability, attachmentId) =>
      voided(c.mutation(internal.store.setDefaultAttachment, { tenantId, projectId, capability, attachmentId })),
    deleteAttachment: (tenantId, attachmentId) =>
      voided(c.mutation(internal.store.deleteAttachment, { tenantId, attachmentId })),

    getBinding: (tenantId, attachmentId, environmentId) =>
      c.query(internal.store.getBinding, { tenantId, attachmentId, environmentId }) as Promise<BindingRow | null>,
    listBindings: (tenantId, attachmentId) =>
      c.query(internal.store.listBindings, { tenantId, attachmentId }) as Promise<BindingRow[]>,
    upsertBinding: (row) => voided(c.mutation(internal.store.upsertBinding, { row })),
    deleteBinding: (tenantId, attachmentId, environmentId) =>
      voided(c.mutation(internal.store.deleteBinding, { tenantId, attachmentId, environmentId })),

    recordAudit: (row) => voided(c.mutation(internal.store.recordAudit, { row: compact(row) })),
    listAudit: (tenantId, options) =>
      c.query(
        internal.store.listAudit,
        compact({ tenantId, limit: options.limit, projectId: options.projectId }),
      ) as Promise<AuditRow[]>,
  };
}
