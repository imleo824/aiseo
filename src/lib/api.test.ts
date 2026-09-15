import { describe, expect, it } from 'vitest';
import { writeRequestFingerprint } from './api';

describe('write request identity', () => {
  it('is stable for an identical logical write', async () => {
    await expect(writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}'))
      .resolves.toBe(await writeRequestFingerprint('post', '/sites', '{"domain":"example.com"}'));
  });

  it('changes when the route or body changes', async () => {
    const original = await writeRequestFingerprint('POST', '/sites', '{"domain":"example.com"}');
    expect(await writeRequestFingerprint('POST', '/sites', '{"domain":"other.example"}')).not.toBe(original);
    expect(await writeRequestFingerprint('POST', '/organizations', '{"domain":"example.com"}')).not.toBe(original);
  });
});
