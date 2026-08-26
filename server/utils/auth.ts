import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_PREFIX = 'scrypt';

export const isPasswordHash = (value?: string): boolean =>
  Boolean(value && value.startsWith(`${SCRYPT_PREFIX}$`));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${SCRYPT_PREFIX}$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedValue?: string): Promise<boolean> {
  if (!storedValue || !isPasswordHash(storedValue)) return false;

  const [, salt, expectedEncoded] = storedValue.split('$');
  if (!salt || !expectedEncoded) return false;

  const expected = Buffer.from(expectedEncoded, 'base64url');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const createSessionToken = (): string => randomBytes(32).toString('base64url');
