/**
 * Browser-side encryption for saved statement-PDF passwords (bank_profiles). Uses Web Crypto only.
 * PBKDF2(SHA-256) derives an AES-GCM key from a user master passphrase; the plaintext PDF password is
 * encrypted and only the ciphertext + salt + iteration count leave the browser. The server never sees
 * the master passphrase, the derived key, or the plaintext password. A forgotten passphrase is
 * unrecoverable by design (no verifier stored — a wrong passphrase fails GCM authentication on decrypt).
 *
 * Storage layout: password_ciphertext = base64( iv(12 bytes) || AES-GCM(ciphertext||tag) ).
 */

export const PBKDF2_ITERATIONS = 600_000; // OWASP-class; matches bank_profiles.kdf_iterations default
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedSecret {
  /** base64( iv || ciphertext+tag ) */
  ciphertext: string;
  /** base64 random salt */
  salt: string;
  iterations: number;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a plaintext PDF password under the master passphrase. Fresh salt + IV each call. */
export async function encryptPassword(plaintext: string, passphrase: string): Promise<EncryptedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array(new TextEncoder().encode(plaintext))),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return { ciphertext: toB64(packed), salt: toB64(salt), iterations: PBKDF2_ITERATIONS };
}

/** Decrypt a saved secret. Throws (GCM auth failure) if the passphrase is wrong or data is tampered. */
export async function decryptPassword(secret: EncryptedSecret, passphrase: string): Promise<string> {
  const packed = fromB64(secret.ciphertext);
  const iv = packed.slice(0, IV_BYTES);
  const ct = packed.slice(IV_BYTES);
  const key = await deriveKey(passphrase, fromB64(secret.salt), secret.iterations);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plain);
}
