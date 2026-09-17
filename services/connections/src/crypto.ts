/**
 * Envelope encryption for stored credentials, in the Worker, with WebCrypto.
 *
 *   plaintext  --AES-256-GCM(DEK, iv, aad)-->  ciphertext
 *   DEK        --AES-256-GCM(KEK, dekIv, aad)-->  wrappedDek
 *
 * One random data key (DEK) per secret; the master key (KEK) comes from the
 * CONNECTIONS_MASTER_KEY secret and never leaves the isolate. The additional
 * authenticated data binds every envelope to the row it belongs to (tenant,
 * owner, environment, field), so a ciphertext copied onto another tenant's
 * row — or another field — fails to open instead of decrypting.
 *
 * Rotation: `keyVersion` names the master key that wrapped the DEK. The
 * previous key stays configured as CONNECTIONS_MASTER_KEY_PREVIOUS until every
 * envelope has been re-saved under the new one.
 */
import { TpxError } from "@tpx/identity";

export interface SecretEnvelope {
  ciphertext: string;
  iv: string;
  wrappedDek: string;
  dekIv: string;
  keyVersion: string;
  hint: string;
}

export interface MasterKeys {
  current: { key: CryptoKey; version: string };
  byVersion: Map<string, CryptoKey>;
}

export class SecretUnavailableError extends TpxError {
  constructor(detail: string) {
    super(500, "secret_unavailable", detail);
    this.name = "SecretUnavailableError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function versionOf(raw: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  return toHex(digest.slice(0, 6));
}

async function importMasterKey(encoded: string, label: string): Promise<{ key: CryptoKey; version: string }> {
  const raw = fromBase64(encoded);
  if (raw.length !== 32) throw new Error(`${label} must decode to exactly 32 bytes`);
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { key, version: await versionOf(raw) };
}

export async function loadMasterKeys(env: {
  CONNECTIONS_MASTER_KEY?: string;
  CONNECTIONS_MASTER_KEY_PREVIOUS?: string;
}): Promise<MasterKeys> {
  if (!env.CONNECTIONS_MASTER_KEY) throw new Error("tpx-connections: CONNECTIONS_MASTER_KEY is not configured");
  const current = await importMasterKey(env.CONNECTIONS_MASTER_KEY, "CONNECTIONS_MASTER_KEY");
  const byVersion = new Map<string, CryptoKey>([[current.version, current.key]]);
  if (env.CONNECTIONS_MASTER_KEY_PREVIOUS) {
    const previous = await importMasterKey(env.CONNECTIONS_MASTER_KEY_PREVIOUS, "CONNECTIONS_MASTER_KEY_PREVIOUS");
    if (!byVersion.has(previous.version)) byVersion.set(previous.version, previous.key);
  }
  return { current, byVersion };
}

export interface AadParts {
  tenantId: string;
  ownerKind: string;
  ownerId: string;
  environmentKey: string;
  key: string;
}

/** The authenticated context an envelope is bound to. Canonical JSON so no id can smuggle a separator. */
export function aadFor(parts: AadParts): string {
  return JSON.stringify([parts.tenantId, parts.ownerKind, parts.ownerId, parts.environmentKey, parts.key]);
}

/** The trailing characters shown beside a masked secret; nothing for short values. */
export function hintFor(value: string): string {
  return value.length >= 8 ? value.slice(-4) : "";
}

export async function seal(keys: MasterKeys, aad: string, plaintext: string): Promise<SecretEnvelope> {
  const aadBytes = encoder.encode(aad);
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadBytes }, dek, encoder.encode(plaintext)),
  );
  const dekIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: dekIv, additionalData: aadBytes }, keys.current.key, dekRaw),
  );
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    wrappedDek: toBase64(wrappedDek),
    dekIv: toBase64(dekIv),
    keyVersion: keys.current.version,
    hint: hintFor(plaintext),
  };
}

export async function open(keys: MasterKeys, aad: string, envelope: SecretEnvelope): Promise<string> {
  const kek = keys.byVersion.get(envelope.keyVersion);
  if (!kek) throw new SecretUnavailableError(`no master key for version ${envelope.keyVersion}`);
  const aadBytes = encoder.encode(aad);
  try {
    const dekRaw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.dekIv), additionalData: aadBytes },
      kek,
      fromBase64(envelope.wrappedDek),
    );
    const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv), additionalData: aadBytes },
      dek,
      fromBase64(envelope.ciphertext),
    );
    return decoder.decode(plain);
  } catch {
    throw new SecretUnavailableError(
      "the stored secret could not be decrypted (wrong key, tampered row, or moved envelope)",
    );
  }
}

/** Constant-time string comparison for digests and tokens. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}
