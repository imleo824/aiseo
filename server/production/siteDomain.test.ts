import { describe, expect, it } from 'vitest';
import { normalizeSiteDomain } from './siteDomain';

describe('site domain boundary', () => {
  it('normalizes a single public HTTPS hostname', () => {
    expect(normalizeSiteDomain('Example.COM')).toBe('example.com');
    expect(normalizeSiteDomain('https://sub.example.com/')).toBe('sub.example.com');
    expect(normalizeSiteDomain('https://例子.测试')).toBe('xn--fsqu00a.xn--0zwm56d');
  });

  it.each([
    'http://example.com',
    'https://example.com:8443',
    'https://example.com/path',
    'https://user:secret@example.com',
    'https://127.0.0.1',
    'https://localhost',
    'https://wordpress.internal'
  ])('rejects a non-canonical or private site origin: %s', (value) => {
    expect(() => normalizeSiteDomain(value)).toThrow(/HTTPS|公开/);
  });
});
