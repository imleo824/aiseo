import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from './env';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const currentVersion = Number(process.env.APP_ENCRYPTION_KEY_VERSION || '1');

const configuredKeys = (): Record<number, string> => {
  const raw = process.env.APP_ENCRYPTION_KEYS?.trim();
  if (!raw) return { [currentVersion]: env.appEncryptionKey };
  const parsed = JSON.parse(raw) as Record<string, string>;
  return Object.fromEntries(Object.entries(parsed).map(([version, key]) => [Number(version), key]));
};

const getKey = (version: number): Buffer => {
  const encoded = configuredKeys()[version];
  if (!encoded) throw new Error(`Encryption key version ${version} is unavailable`);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`APP_ENCRYPTION_KEY version ${version} must be a base64-encoded 32-byte key`);
  }
  return key;
};

export const encryptSecret = (value: unknown): Buffer => {
  if (!Number.isInteger(currentVersion) || currentVersion < 1 || currentVersion > 255) {
    throw new Error('APP_ENCRYPTION_KEY_VERSION must be an integer from 1 to 255');
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(currentVersion), nonce);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([currentVersion]), nonce, tag, ciphertext]);
};

export const decryptSecret = <T>(payload: Buffer): T => {
  if (payload.length <= 1 + NONCE_BYTES + TAG_BYTES) {
    throw new Error('Unsupported encrypted credential payload');
  }
  const version = payload[0];
  const nonce = payload.subarray(1, 1 + NONCE_BYTES);
  const tag = payload.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', getKey(version), nonce);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
};

export const encryptedSecretVersion = (payload: Uint8Array): number => payload[0] || 0;
export const currentEncryptionKeyVersion = (): number => currentVersion;
export const reencryptSecret = (payload: Buffer): Buffer => encryptSecret(decryptSecret(payload));
