/**
 * The store seam of the connections service. Rows only; the service interprets.
 * `secrets` rows are ciphertext envelopes — the store never sees plaintext.
 */
export type OwnerKind = "connection-base" | "connection-environment" | "attachment" | "binding";

/** Where a secret lives. `environmentKey` is the environment NAME for connection defaults, the environment ID for bindings, "" otherwise. */
export interface OwnerRef {
  ownerKind: OwnerKind;
  ownerId: string;
  environmentKey: string;
}

export interface ConnectionRow {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  capabilities: string[];
  config: Record<string, string>;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  lastTest: { at: number; ok: boolean; message: string } | null;
}

export interface EnvironmentDefaultRow {
  connectionId: string;
  tenantId: string;
  environmentName: string;
  config: Record<string, string>;
}

export interface SecretRow extends OwnerRef {
  id: string;
  tenantId: string;
  key: string;
  ciphertext: string;
  iv: string;
  wrappedDek: string;
  dekIv: string;
  keyVersion: string;
  hint: string;
  createdAt: number;
  updatedAt: number;
}

export interface AttachmentRow {
  id: string;
  tenantId: string;
  projectId: string;
  connectionId: string;
  name: string;
  capability: string;
  isDefault: boolean;
  config: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface BindingRow {
  attachmentId: string;
  environmentId: string;
  tenantId: string;
  projectId: string;
  config: Record<string, string>;
  updatedAt: number;
}

export interface AuditRow {
  id: string;
  tenantId: string;
  projectId: string | null;
  environmentId: string | null;
  userId: string;
  action: string;
  target: string;
  level: string | null;
  at: number;
  detail?: unknown;
}

export interface ConnectionsStore {
  listConnections(tenantId: string): Promise<ConnectionRow[]>;
  getConnection(tenantId: string, connectionId: string): Promise<ConnectionRow | null>;
  insertConnection(row: ConnectionRow): Promise<void>;
  updateConnection(
    tenantId: string,
    connectionId: string,
    patch: {
      name?: string;
      config?: Record<string, string>;
      capabilities?: string[];
      lastTest?: ConnectionRow["lastTest"];
      updatedAt: number;
    },
  ): Promise<void>;
  /** Cascades: environment defaults, every secret of the connection, its attachments and their bindings and secrets. */
  deleteConnection(tenantId: string, connectionId: string): Promise<void>;

  listEnvironmentDefaults(tenantId: string, connectionId: string): Promise<EnvironmentDefaultRow[]>;
  upsertEnvironmentDefault(row: EnvironmentDefaultRow): Promise<void>;

  listSecrets(tenantId: string, owners: OwnerRef[]): Promise<SecretRow[]>;
  upsertSecret(row: SecretRow): Promise<void>;
  deleteSecret(tenantId: string, owner: OwnerRef, key: string): Promise<void>;
  deleteSecretsForOwner(tenantId: string, owner: OwnerRef): Promise<void>;

  listAttachments(tenantId: string, projectId: string): Promise<AttachmentRow[]>;
  getAttachment(tenantId: string, attachmentId: string): Promise<AttachmentRow | null>;
  listAttachmentsForConnection(tenantId: string, connectionId: string): Promise<AttachmentRow[]>;
  /** False when the project already has an attachment of that capability and name. */
  insertAttachment(row: AttachmentRow): Promise<boolean>;
  updateAttachment(
    tenantId: string,
    attachmentId: string,
    patch: { name?: string; config?: Record<string, string>; isDefault?: boolean; updatedAt: number },
  ): Promise<void>;
  /** Makes one attachment the default for its capability within the project, clearing the others. */
  setDefaultAttachment(tenantId: string, projectId: string, capability: string, attachmentId: string): Promise<void>;
  /** Cascades: bindings and every secret of the attachment and its bindings. */
  deleteAttachment(tenantId: string, attachmentId: string): Promise<void>;

  getBinding(tenantId: string, attachmentId: string, environmentId: string): Promise<BindingRow | null>;
  listBindings(tenantId: string, attachmentId: string): Promise<BindingRow[]>;
  upsertBinding(row: BindingRow): Promise<void>;
  deleteBinding(tenantId: string, attachmentId: string, environmentId: string): Promise<void>;

  recordAudit(row: AuditRow): Promise<void>;
  /** Newest first. */
  listAudit(tenantId: string, options: { limit: number; projectId?: string }): Promise<AuditRow[]>;
}
