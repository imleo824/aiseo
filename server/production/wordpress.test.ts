import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/networkSafety', () => ({
  resolvePublicHttpsOrigin: vi.fn(async () => 'https://example.com')
}));

const savedEnvironment = { ...process.env };

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of Object.keys(process.env)) if (!(name in savedEnvironment)) delete process.env[name];
  Object.assign(process.env, savedEnvironment);
});

describe('WordPress atomic read executor', () => {
  it('discovers the official same-origin Application Password authorization endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ authentication: { 'application-passwords': { endpoints: { authorization: 'https://example.com/wp-admin/authorize-application.php' } } } }), { status: 200 })));
    const { wordPressService } = await import('./wordpress');
    await expect(wordPressService.applicationPasswordAuthorizationUrl('example.com')).resolves.toBe('https://example.com/wp-admin/authorize-application.php');
  });

  it('rejects a cross-origin Application Password authorization endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ authentication: { 'application-passwords': { endpoints: { authorization: 'https://attacker.test/authorize' } } } }), { status: 200 })));
    const { wordPressService } = await import('./wordpress');
    await expect(wordPressService.applicationPasswordAuthorizationUrl('example.com')).rejects.toThrow('跨站');
  });

  it('captures the exact editable resource needed for a lossless rollback without credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 42,
        link: 'https://example.com/guides/crm/',
        slug: 'crm',
        status: 'publish',
        modified_gmt: '2026-08-30T12:00:00',
        title: { raw: 'Enterprise CRM Guide' },
        content: { raw: '<p>Customer-owned page content</p>' }
      }]), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    const result = await wordPressService.inspectTarget({ domain: 'example.com', encrypted, targetUrl: 'https://example.com/guides/crm/' });

    expect(result).toMatchObject({ postId: '42', resourceType: 'posts', url: 'https://example.com/guides/crm/', title: 'Enterprise CRM Guide', status: 'publish' });
    expect(result.contentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.contentLength).toBeGreaterThan(0);
    expect(result.content).toContain('Customer-owned page content');
    expect(JSON.stringify(result)).not.toContain('abcd efgh');
  });

  it('rejects a cross-origin target before requesting WordPress', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.inspectTarget({ domain: 'example.com', encrypted, targetUrl: 'https://attacker.test/crm' })).rejects.toThrow('已验证 WordPress 站点内');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the slug resolves to a different canonical URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 42, link: 'https://example.com/other/crm/', title: { raw: 'Wrong page' }, content: { raw: 'x' } }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.inspectTarget({ domain: 'example.com', encrypted, targetUrl: 'https://example.com/guides/crm/' })).rejects.toThrow('精确匹配');
  });

  it('rejects WordPress REST redirects instead of forwarding credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {
      status: 302,
      headers: { location: 'https://redirected.example/wp-json' }
    })));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.testConnection('example.com', encrypted)).rejects.toThrow('不允许重定向');
  });

  it('recognizes only its own delivery marker when a publish job is retried', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: 42,
      link: 'https://example.com/verified-delivery/',
      content: { raw: '<!-- aiseo-delivery:00000000-0000-4000-8000-000000000042 -->\n<p>Delivered</p>' }
    }]), { status: 200 })));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.publish({
      domain: 'example.com', encrypted, title: 'Verified delivery', slug: 'verified-delivery', html: '<p>Delivered</p>', deliveryId: '00000000-0000-4000-8000-000000000042'
    })).resolves.toEqual({ postId: '42', url: 'https://example.com/verified-delivery/' });
  });

  it('stops on an unrelated existing slug instead of treating it as a successful retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      id: 9,
      link: 'https://example.com/existing/',
      content: { raw: '<p>Customer-authored content</p>' }
    }]), { status: 200 })));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.publish({
      domain: 'example.com', encrypted, title: 'New content', slug: 'existing', html: '<p>New</p>', deliveryId: '00000000-0000-4000-8000-000000000042'
    })).rejects.toThrow('相同 slug');
  });

  it('builds a bounded site inventory with real internal links', async () => {
    const repeated = 'WordPress SEO performance guidance '.repeat(10);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 42,
        link: 'https://example.com/wordpress-seo/',
        slug: 'wordpress-seo',
        status: 'publish',
        title: { raw: 'WordPress SEO Guide' },
        content: { raw: `<p>${repeated}</p><script>ignored()</script>` }
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        id: 7,
        link: 'https://example.com/about/',
        slug: 'about',
        status: 'publish',
        title: { rendered: 'About the company' },
        content: { rendered: '<p>Verified company page content for source grounding.</p>' }
      }]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    const context = await wordPressService.readSiteContext('example.com', encrypted);

    expect(context.internalLinks).toEqual([
      { title: 'WordPress SEO Guide', url: 'https://example.com/wordpress-seo' },
      { title: 'About the company', url: 'https://example.com/about' }
    ]);
    expect(context.content).toContain('URL: https://example.com/wordpress-seo');
    expect(context.content).not.toContain('ignored()');
    expect(context.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
