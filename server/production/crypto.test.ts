import { afterEach, describe, expect, it, vi } from 'vitest';

const originalKey = process.env.APP_ENCRYPTION_KEY;

afterEach(() => {
  process.env.APP_ENCRYPTION_KEY = originalKey;
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
});
