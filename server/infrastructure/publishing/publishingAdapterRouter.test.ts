import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishingAdapterRouter, publishingNotConfiguredMessage } from './publishingAdapterRouter';
import { WordPressAdapter } from '../wordpress/wordpressAdapter';

const ghostSite = {
  id: 'site-ghost',
  name: 'Ghost publication',
  domain: 'ghost.example.com',
  siteType: 'GHOST' as const
};

afterEach(() => vi.unstubAllGlobals());

describe('site-type publishing dispatch', () => {
  it('requires a verified WordPress publishing connection before a paid run', () => {
    expect(publishingAdapterRouter.readiness({
      id: 'site-wp', siteType: 'WORDPRESS', connectorStatus: 'CONNECTED'
    } as any)).toMatchObject({ ready: false });
    expect(publishingAdapterRouter.readiness({
      id: 'site-wp', siteType: 'WORDPRESS', wpAppPassword: 'app-password', connectorStatus: 'DISCONNECTED'
    } as any)).toMatchObject({ ready: false });
    expect(publishingAdapterRouter.readiness({
      id: 'site-wp', siteType: 'WORDPRESS', wpAppPassword: 'app-password', connectorStatus: 'CONNECTED'
    } as any)).toMatchObject({ ready: true, provider: 'WordPress' });
  });

  it('blocks an unsupported site type without making a WordPress HTTP call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishingAdapterRouter.forSite(ghostSite as any).publishPost(ghostSite as any, {
      title: 'A real article',
      contentHtml: '<h2>Content</h2><p>Body</p>'
    });

    expect(publishingAdapterRouter.supports(ghostSite as any)).toBe(false);
    expect(result).toMatchObject({ success: false, error: publishingNotConfiguredMessage(ghostSite) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defends against direct WordPress-adapter use for a non-WordPress site', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new WordPressAdapter().testConnection(ghostSite as any);

    expect(result.connected).toBe(false);
    expect(result.message).toContain('不会调用 WordPress REST API');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
