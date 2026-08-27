import { afterEach, describe, expect, it, vi } from 'vitest';
import { WordPressAdapter } from './wordpressAdapter';

vi.mock('../../utils/networkSafety', () => ({
  resolvePublicHttpsOrigin: vi.fn(async () => 'https://example.com')
}));

const wordpressSite = {
  id: 'site-wp',
  name: 'Customer WordPress',
  domain: 'example.com',
  siteType: 'WORDPRESS' as const
};

afterEach(() => vi.unstubAllGlobals());

describe('WordPress publishing connection', () => {
  it('does not mark a public REST endpoint as publish-ready without credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WordPressAdapter().testConnection(wordpressSite as any);

    expect(result.connected).toBe(false);
    expect(result.message).toContain('应用密码');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an authenticated publishing identity after the REST root responds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Customer site' }) })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WordPressAdapter().testConnection({
      ...wordpressSite,
      wpUsername: 'publisher',
      wpAppPassword: 'application-password'
    } as any);

    expect(result.connected).toBe(false);
    expect(result.message).toContain('发布鉴权失败');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
