import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";

const KEY_VERSION = "v1";
const VAULT_KEY_NAME = "career_gate_gate_job_credentials_v1";
let keyPromise: Promise<Buffer> | null = null;

export type EncryptedGateJobSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
};

function decodeKey(value: string) {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) throw new Error("Gate Job credential key must decode to exactly 32 bytes");
  return key;
}

async function loadKey() {
  const envKey = process.env.GATE_JOB_CREDENTIALS_KEY_V1;
  if (envKey) return decodeKey(envKey);

  const [row] = await sql()`
    select decrypted_secret
    from vault.decrypted_secrets
    where name = ${VAULT_KEY_NAME}
    order by created_at desc
    limit 1`;
  if (!row?.decrypted_secret) throw new Error("Gate Job credential encryption key is not configured");
  return decodeKey(String(row.decrypted_secret));
}

async function key() {
  keyPromise ??= loadKey();
  return keyPromise;
}

export async function ensureGateJobEncryptionReady() {
  await key();
}

export async function encryptGateJobSecret(plaintext: string, context: string): Promise<EncryptedGateJobSecret> {
  const secretKey = await key();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    keyVersion: KEY_VERSION,
  };
}

export async function decryptGateJobSecret(secret: EncryptedGateJobSecret, context: string) {
  if (secret.keyVersion !== KEY_VERSION) throw new Error(`Unsupported Gate Job credential key version: ${secret.keyVersion}`);
  const secretKey = await key();
  const decipher = createDecipheriv("aes-256-gcm", secretKey, Buffer.from(secret.nonce, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
