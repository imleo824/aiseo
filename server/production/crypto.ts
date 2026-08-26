import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from './env';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

const getKey = (): Buffer => {
  const key = Buffer.from(env.appEncryptionKey, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
};

export const encryptSecret = (value: unknown): Buffer => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), nonce);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), nonce, tag, ciphertext]);
};

export const decryptSecret = <T>(payload: Buffer): T => {
  if (payload.length <= 1 + NONCE_BYTES + TAG_BYTES || payload[0] !== VERSION) {
    throw new Error('Unsupported encrypted credential payload');
  }
  const nonce = payload.subarray(1, 1 + NONCE_BYTES);
  const tag = payload.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), nonce);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
};
