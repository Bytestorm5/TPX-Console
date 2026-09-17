/** In-memory ConnectionsStore for Worker-runtime tests. Same cascades as the Convex functions. */
import type {
  AttachmentRow,
  AuditRow,
  BindingRow,
  ConnectionRow,
  ConnectionsStore,
  EnvironmentDefaultRow,
  OwnerRef,
  SecretRow,
} from "./types.ts";

const clone = <T>(v: T): T => structuredClone(v);
const ownerKey = (tenantId: string, o: OwnerRef, key: string) =>
  [tenantId, o.ownerKind, o.ownerId, o.environmentKey, key].join("|");

export interface MemoryStore extends ConnectionsStore {
  /** Test-only peek at the raw rows. */
  readonly rows: {
    secrets: Map<string, SecretRow>;
    connections: Map<string, ConnectionRow>;
    attachments: Map<string, AttachmentRow>;
    bindings: Map<string, BindingRow>;
  };
}

export function memoryStore(): MemoryStore {
  const connections = new Map<string, ConnectionRow>();
  const environmentDefaults = new Map<string, EnvironmentDefaultRow>();
  const secrets = new Map<string, SecretRow>();
  const attachments = new Map<string, AttachmentRow>();
  const bindings = new Map<string, BindingRow>();
  const audit: AuditRow[] = [];

  const deleteSecretsWhere = (pred: (s: SecretRow) => boolean) => {
    for (const [k, s] of secrets) if (pred(s)) secrets.delete(k);
  };
  const deleteAttachmentCascade = (att: AttachmentRow) => {
    for (const [k, b] of bindings) if (b.attachmentId === att.id) bindings.delete(k);
    deleteSecretsWhere(
      (s) =>
        s.tenantId === att.tenantId &&
        (s.ownerKind === "attachment" || s.ownerKind === "binding") &&
        s.ownerId === att.id,
    );
    attachments.delete(att.id);
  };

  return {
    rows: { secrets, connections, attachments, bindings },
    async listConnections(tenantId) {
      return [...connections.values()]
        .filter((c) => c.tenantId === tenantId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async getConnection(tenantId, id) {
      const c = connections.get(id);
      return c && c.tenantId === tenantId ? clone(c) : null;
    },
    async insertConnection(row) {
      if (connections.has(row.id)) throw new Error(`connection ${row.id} already exists`);
      connections.set(row.id, clone(row));
    },
    async updateConnection(tenantId, id, patch) {
      const c = connections.get(id);
      if (!c || c.tenantId !== tenantId) throw new Error("connection not found");
      connections.set(id, {
        ...c,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.config === undefined ? {} : { config: clone(patch.config) }),
        ...(patch.capabilities === undefined ? {} : { capabilities: [...patch.capabilities] }),
        ...(patch.lastTest === undefined ? {} : { lastTest: clone(patch.lastTest) }),
        updatedAt: patch.updatedAt,
      });
    },
    async deleteConnection(tenantId, id) {
      const c = connections.get(id);
      if (!c || c.tenantId !== tenantId) return;
      for (const [k, d] of environmentDefaults) if (d.connectionId === id) environmentDefaults.delete(k);
      deleteSecretsWhere(
        (s) =>
          s.tenantId === tenantId &&
          (s.ownerKind === "connection-base" || s.ownerKind === "connection-environment") &&
          s.ownerId === id,
      );
      for (const att of [...attachments.values()])
        if (att.connectionId === id && att.tenantId === tenantId) deleteAttachmentCascade(att);
      connections.delete(id);
    },
    async listEnvironmentDefaults(tenantId, connectionId) {
      return [...environmentDefaults.values()]
        .filter((d) => d.tenantId === tenantId && d.connectionId === connectionId)
        .map(clone);
    },
    async upsertEnvironmentDefault(row) {
      environmentDefaults.set(`${row.connectionId}|${row.environmentName}`, clone(row));
    },
    async listSecrets(tenantId, owners) {
      const out: SecretRow[] = [];
      for (const o of owners) {
        for (const s of secrets.values()) {
          if (
            s.tenantId === tenantId &&
            s.ownerKind === o.ownerKind &&
            s.ownerId === o.ownerId &&
            s.environmentKey === o.environmentKey
          )
            out.push(clone(s));
        }
      }
      return out;
    },
    async upsertSecret(row) {
      const k = ownerKey(row.tenantId, row, row.key);
      const existing = secrets.get(k);
      secrets.set(k, clone({ ...row, createdAt: existing?.createdAt ?? row.createdAt }));
    },
    async deleteSecret(tenantId, owner, key) {
      secrets.delete(ownerKey(tenantId, owner, key));
    },
    async deleteSecretsForOwner(tenantId, owner) {
      deleteSecretsWhere(
        (s) =>
          s.tenantId === tenantId &&
          s.ownerKind === owner.ownerKind &&
          s.ownerId === owner.ownerId &&
          s.environmentKey === owner.environmentKey,
      );
    },
    async listAttachments(tenantId, projectId) {
      return [...attachments.values()]
        .filter((a) => a.tenantId === tenantId && a.projectId === projectId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(clone);
    },
    async getAttachment(tenantId, id) {
      const a = attachments.get(id);
      return a && a.tenantId === tenantId ? clone(a) : null;
    },
    async listAttachmentsForConnection(tenantId, connectionId) {
      return [...attachments.values()]
        .filter((a) => a.tenantId === tenantId && a.connectionId === connectionId)
        .map(clone);
    },
    async insertAttachment(row) {
      if (
        [...attachments.values()].some(
          (a) => a.projectId === row.projectId && a.capability === row.capability && a.name === row.name,
        )
      )
        return false;
      attachments.set(row.id, clone(row));
      return true;
    },
    async updateAttachment(tenantId, id, patch) {
      const a = attachments.get(id);
      if (!a || a.tenantId !== tenantId) throw new Error("attachment not found");
      attachments.set(id, {
        ...a,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.config === undefined ? {} : { config: clone(patch.config) }),
        ...(patch.isDefault === undefined ? {} : { isDefault: patch.isDefault }),
        updatedAt: patch.updatedAt,
      });
    },
    async setDefaultAttachment(tenantId, projectId, capability, attachmentId) {
      for (const [id, a] of attachments) {
        if (a.tenantId === tenantId && a.projectId === projectId && a.capability === capability)
          attachments.set(id, { ...a, isDefault: id === attachmentId });
      }
    },
    async deleteAttachment(tenantId, id) {
      const a = attachments.get(id);
      if (a && a.tenantId === tenantId) deleteAttachmentCascade(a);
    },
    async getBinding(tenantId, attachmentId, environmentId) {
      const b = bindings.get(`${attachmentId}|${environmentId}`);
      return b && b.tenantId === tenantId ? clone(b) : null;
    },
    async listBindings(tenantId, attachmentId) {
      return [...bindings.values()]
        .filter((b) => b.tenantId === tenantId && b.attachmentId === attachmentId)
        .map(clone);
    },
    async upsertBinding(row) {
      bindings.set(`${row.attachmentId}|${row.environmentId}`, clone(row));
    },
    async deleteBinding(tenantId, attachmentId, environmentId) {
      const b = bindings.get(`${attachmentId}|${environmentId}`);
      if (b && b.tenantId === tenantId) bindings.delete(`${attachmentId}|${environmentId}`);
    },
    async recordAudit(row) {
      audit.push(clone(row));
    },
    async listAudit(tenantId, options) {
      return audit
        .filter(
          (a) => a.tenantId === tenantId && (options.projectId === undefined || a.projectId === options.projectId),
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, options.limit)
        .map(clone);
    },
  };
}
