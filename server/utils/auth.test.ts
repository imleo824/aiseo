import { describe, expect, it } from 'vitest';
import { createSessionToken, hashPassword, verifyPassword } from './auth';

describe('password and session primitives', () => {
  it('hashes a password and verifies only the original value', async () => {
    const hash = await hashPassword('a-long-test-password');

    expect(hash).toMatch(/^scrypt\$/);
    await expect(verifyPassword('a-long-test-password', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('creates opaque, high-entropy session tokens', () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(first).not.toContain('tenant');
  });
});
