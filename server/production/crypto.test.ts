import { afterEach, describe, expect, it, vi } from 'vitest';

const originalKey = process.env.APP_ENCRYPTION_KEY;
const originalKeys = process.env.APP_ENCRYPTION_KEYS;
const originalVersion = process.env.APP_ENCRYPTION_KEY_VERSION;

afterEach(() => {
  if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY; else process.env.APP_ENCRYPTION_KEY = originalKey;
  if (originalKeys === undefined) delete process.env.APP_ENCRYPTION_KEYS; else process.env.APP_ENCRYPTION_KEYS = originalKeys;
  if (originalVersion === undefined) delete process.env.APP_ENCRYPTION_KEY_VERSION; else process.env.APP_ENCRYPTION_KEY_VERSION = originalVersion;
  vi.resetModules();
});

describe('credential envelope encryption', () => {
  it('round-trips a credential without retaining plaintext', async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const { decryptSecret, encryptSecret } = await import('./crypto');
    const encrypted = encryptSecret({ refreshToken: 'secret-token', siteUrl: 'sc-domain:example.com' });
    expect(encrypted.includes(Buffer.from('secret-token'))).toBe(false);
    expect(decryptSecret<{ refreshToken: string }>(encrypted).refreshToken).toBe('secret-token');
  });

  it('rejects a malformed key', async () => {
    process.env.APP_ENCRYPTION_KEY = 'not-a-valid-32-byte-key';
    const { encryptSecret } = await import('./crypto');
    expect(() => encryptSecret({ value: 'x' })).toThrow('APP_ENCRYPTION_KEY');
  });

  it('supports versioned keys and rejects truncated envelopes', async () => {
    const versionedKey = Buffer.alloc(32, 8).toString('base64');
    process.env.APP_ENCRYPTION_KEY = versionedKey;
    process.env.APP_ENCRYPTION_KEY_VERSION = '2';
    process.env.APP_ENCRYPTION_KEYS = JSON.stringify({ 1: Buffer.alloc(32, 7).toString('base64'), 2: versionedKey });
    const { currentEncryptionKeyVersion, decryptSecret, encryptedSecretVersion, encryptSecret, reencryptSecret } = await import('./crypto');

    const encrypted = encryptSecret({ token: 'rotatable' });
    expect(currentEncryptionKeyVersion()).toBe(2);
    expect(encryptedSecretVersion(encrypted)).toBe(2);
    expect(decryptSecret<{ token: string }>(reencryptSecret(encrypted))).toEqual({ token: 'rotatable' });
    expect(() => decryptSecret(Buffer.alloc(8))).toThrow('Unsupported encrypted credential payload');
  });
});
