import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('dns/promises', () => ({ lookup }));

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('outbound WordPress network safety', () => {
  it('rejects private addresses after DNS resolution', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const { resolvePublicHttpsOrigin } = await import('./networkSafety');
    await expect(resolvePublicHttpsOrigin('example.com')).rejects.toThrow('私有网络');
  });

  it('requires HTTPS and accepts a public hostname', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const { resolvePublicHttpsOrigin } = await import('./networkSafety');
    await expect(resolvePublicHttpsOrigin('http://example.com')).rejects.toThrow('公网 HTTPS');
    await expect(resolvePublicHttpsOrigin('example.com')).resolves.toBe('https://example.com');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
