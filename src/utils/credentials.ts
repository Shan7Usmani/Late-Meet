const STORAGE_KEY_ID = "credential_encryption_key_id";
const ENCRYPTED_MARKER = "enc:";

export type CredentialKey = "openai_api_key" | "elevenlabs_api_key";

export interface ApiCredentials {
  openai_api_key?: string;
  elevenlabs_api_key?: string;
}

const CREDENTIAL_KEYS: CredentialKey[] = ["openai_api_key", "elevenlabs_api_key"];

function normalizedCredential(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// SubtleCrypto AES-GCM helpers
// ---------------------------------------------------------------------------

const AES_ALGORITHM = "AES-GCM";
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;

function arrayBufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function generateEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToHex(raw);
}

async function importKey(hex: string): Promise<CryptoKey> {
  const raw = hexToArrayBuffer(hex);
  return crypto.subtle.importKey("raw", raw, { name: AES_ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function getOrCreateEncryptionKey(): Promise<CryptoKey | null> {
  const { [STORAGE_KEY_ID]: keyId } = await chrome.storage.session.get(STORAGE_KEY_ID);
  if (typeof keyId === "string") {
    return importKey(keyId);
  }
  return null;
}

async function createAndStoreEncryptionKey(): Promise<CryptoKey> {
  const key = await generateEncryptionKey();
  const keyId = await exportKey(key);
  await chrome.storage.session.set({ [STORAGE_KEY_ID]: keyId });
  return key;
}

async function ensureEncryptionKey(): Promise<CryptoKey | null> {
  const existing = await getOrCreateEncryptionKey();
  if (existing) return existing;
  return createAndStoreEncryptionKey();
}

async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGORITHM, iv },
    key,
    encoded,
  );
  // Prepend IV to ciphertext, base64-encode the whole thing
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return arrayBufferToBase64(combined.buffer);
}

async function decrypt(encoded: string, key: CryptoKey): Promise<string> {
  const combined = base64ToArrayBuffer(encoded);
  const iv = new Uint8Array(combined.slice(0, IV_LENGTH));
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

async function encryptCredentials(
  credentials: ApiCredentials,
): Promise<ApiCredentials> {
  const key = await ensureEncryptionKey();
  if (!key) return credentials;

  const encrypted: ApiCredentials = {};
  for (const [k, v] of Object.entries(credentials)) {
    if (v) {
      encrypted[k as CredentialKey] = await encrypt(v, key);
    }
  }
  return encrypted;
}

async function decryptCredentials(
  encrypted: ApiCredentials,
): Promise<ApiCredentials> {
  const key = await ensureEncryptionKey();
  if (!key) return {};

  const decrypted: ApiCredentials = {};
  for (const k of CREDENTIAL_KEYS) {
    const v = encrypted[k];
    if (v) {
      try {
        decrypted[k] = await decrypt(v, key);
      } catch {
        // Decryption failure — key rotated or invalid; skip
      }
    }
  }
  return decrypted;
}

function markEncrypted(data: ApiCredentials): ApiCredentials {
  const marked: ApiCredentials = {};
  for (const k of CREDENTIAL_KEYS) {
    const v = data[k];
    if (v) {
      marked[k] = ENCRYPTED_MARKER + v;
    }
  }
  return marked;
}

function unmarkEncrypted(data: Record<string, unknown>): ApiCredentials {
  const unmarked: ApiCredentials = {};
  for (const k of CREDENTIAL_KEYS) {
    const v = data[k];
    if (typeof v === "string" && v.startsWith(ENCRYPTED_MARKER)) {
      unmarked[k] = v.slice(ENCRYPTED_MARKER.length);
    }
  }
  return unmarked;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getApiCredentials(): Promise<ApiCredentials> {
  const [sessionCredentials, localCredentials] = await Promise.all([
    chrome.storage.session.get(CREDENTIAL_KEYS),
    chrome.storage.local.get(CREDENTIAL_KEYS),
  ]);

  const credentials: ApiCredentials = {};
  const sessionSync: ApiCredentials = {};

  for (const key of CREDENTIAL_KEYS) {
    const sessionValue = normalizedCredential(sessionCredentials[key]);
    const resolvedValue = sessionValue;

    if (resolvedValue) {
      credentials[key] = resolvedValue;
    }
  }

  // Decrypt and sync any local-storage credentials not already in session
  const encryptedLocal = unmarkEncrypted(localCredentials);
  if (Object.keys(encryptedLocal).length > 0) {
    const decryptedLocal = await decryptCredentials(encryptedLocal);
    for (const key of CREDENTIAL_KEYS) {
      const v = decryptedLocal[key];
      if (v && !credentials[key]) {
        credentials[key] = v;
        sessionSync[key] = v;
      }
    }
  }

  if (Object.keys(sessionSync).length > 0) {
    await chrome.storage.session.set(sessionSync);
  }

  return credentials;
}

export async function getOpenAiApiKey(): Promise<string | null> {
  const credentials = await getApiCredentials();
  return credentials.openai_api_key || null;
}

export async function getElevenLabsApiKey(): Promise<string | null> {
  const credentials = await getApiCredentials();
  return credentials.elevenlabs_api_key || null;
}

export async function saveApiCredentials(credentials: ApiCredentials): Promise<void> {
  const saveData: ApiCredentials = {};
  const removeKeys: CredentialKey[] = [];

  for (const key of CREDENTIAL_KEYS) {
    const value = normalizedCredential(credentials[key]);
    if (value) {
      saveData[key] = value;
    } else {
      removeKeys.push(key);
    }
  }

  const operations: Promise<unknown>[] = [];

  if (Object.keys(saveData).length > 0) {
    // Store plaintext in session (in-memory only)
    operations.push(chrome.storage.session.set(saveData));

    // Encrypt before writing to local (persistent) storage
    const encrypted = markEncrypted(await encryptCredentials(saveData));
    operations.push(chrome.storage.local.set(encrypted));
  }

  if (removeKeys.length > 0) {
    operations.push(
      chrome.storage.session.remove(removeKeys),
      chrome.storage.local.remove(removeKeys),
    );
  }

  await Promise.all(operations);
}
