import { describe, expect, it } from 'vitest';
import { sameWordPressAuthorization } from './wordpressCompatibility';

describe('WordPress authorization fencing', () => {
  it('accepts an unchanged domain and byte-identical encrypted credential', () => {
    expect(sameWordPressAuthorization(
      { domain: 'https://example.com', wordpressCredentials: Uint8Array.from([1, 2, 3]) },
      { domain: 'https://example.com', wordpressCredentials: Uint8Array.from([1, 2, 3]) }
    )).toBe(true);
  });

  it('rejects a changed domain, changed credential or removed authorization', () => {
    const expected = { domain: 'https://example.com', wordpressCredentials: Uint8Array.from([1, 2, 3]) };
    expect(sameWordPressAuthorization({ domain: 'https://other.example', wordpressCredentials: Uint8Array.from([1, 2, 3]) }, expected)).toBe(false);
    expect(sameWordPressAuthorization({ domain: 'https://example.com', wordpressCredentials: Uint8Array.from([1, 2, 4]) }, expected)).toBe(false);
    expect(sameWordPressAuthorization({ domain: 'https://example.com', wordpressCredentials: null }, expected)).toBe(false);
  });
});
