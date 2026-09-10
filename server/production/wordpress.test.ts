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
  it('fingerprints every page checksum even when the AI corpus representation is bounded', async () => {
    const { wordpressPageActionCapabilities, wordpressSiteEvidenceFingerprint } = await import('./wordpress');
    const page = (url: string, contentChecksum: string) => ({
      wordpressId: url.endsWith('/a') ? '1' : '2', resourceType: 'posts', url, slug: url.endsWith('/a') ? 'a' : 'b', status: 'publish',
      title: 'Verified page', excerpt: '', content: '<p>bounded representation</p>', contentChecksum, wordCount: 2,
      internalLinks: [], seoMetadata: {}, editorKind: 'CLASSIC' as const, structureChecksum: 'b'.repeat(64),
      actionCapabilities: wordpressPageActionCapabilities('CLASSIC', '<p>bounded representation</p>')
    });
    const common = {
      site: { name: 'Example', description: 'Verified service', url: 'https://example.com' },
      inventory: { resourceTypes: ['posts'], categories: 0, tags: 0, media: 0 },
      taxonomyContent: '',
      mediaContent: ''
    };
    const first = wordpressSiteEvidenceFingerprint({ ...common, pages: [page('https://example.com/a', 'a'.repeat(64)), page('https://example.com/b', 'c'.repeat(64))] });
    const reordered = wordpressSiteEvidenceFingerprint({ ...common, pages: [page('https://example.com/b', 'c'.repeat(64)), page('https://example.com/a', 'a'.repeat(64))] });
    const changedLatePage = wordpressSiteEvidenceFingerprint({ ...common, pages: [page('https://example.com/a', 'a'.repeat(64)), page('https://example.com/b', 'd'.repeat(64))] });
    expect(reordered).toBe(first);
    expect(changedLatePage).not.toBe(first);
  });

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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/revisions?')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 42, link: 'https://example.com/verified-delivery/', slug: 'verified-delivery', status: 'publish',
        title: { raw: 'Verified delivery' },
        content: { raw: '<!-- aiseo-delivery:00000000-0000-4000-8000-000000000042 -->\n<p>Delivered</p>' }
      }]), { status: 200 });
      return new Response('<html><title>Verified delivery</title><!-- aiseo-delivery:00000000-0000-4000-8000-000000000042 --></html>', { status: 200 });
    }));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.publish({
      domain: 'example.com', encrypted, title: 'Verified delivery', slug: 'verified-delivery', html: '<p>Delivered</p>', deliveryId: '00000000-0000-4000-8000-000000000042'
    })).resolves.toMatchObject({ postId: '42', url: 'https://example.com/verified-delivery/', verification: { reachable: true } });
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

  it('recognizes a completed existing-page update after a worker crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/revisions?')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 42, link: 'https://example.com/existing/', slug: 'existing', status: 'publish',
        modified_gmt: '2026-09-01T01:02:03', title: { raw: 'Old title' },
        content: { raw: '<!-- aiseo-delivery:00000000-0000-4000-8000-000000000042 -->\n<p>Old</p><p>Delivered update</p>' }
      }]), { status: 200 });
      return new Response('<html><!-- aiseo-delivery:00000000-0000-4000-8000-000000000042 --></html>', { status: 200 });
    }));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    const result = await wordPressService.update({
      domain: 'example.com',
      encrypted,
      deliveryId: '00000000-0000-4000-8000-000000000042',
      title: 'Old title',
      html: '<p>Old</p><p>Delivered update</p>',
      actionType: 'ADD_CONTENT_SECTION',
      capability: { supported: true, reason: 'classic', strategy: 'CLASSIC_DOM' },
      snapshot: {
        postId: '42', resourceType: 'posts', url: 'https://example.com/existing/', status: 'publish',
        modifiedAt: '2026-08-31T01:02:03', slug: 'existing', title: 'Old title', content: '<p>Old</p>',
        contentChecksum: 'old-checksum', contentLength: 10, editorKind: 'CLASSIC', structureChecksum: 'a'.repeat(64), seoMetadata: {}
      }
    });

    expect(result).toMatchObject({ postId: '42', url: 'https://example.com/existing/' });
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('writes an update marker and captures the exact remote version', async () => {
    const deliveryId = '00000000-0000-4000-8000-000000000042';
    let written = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/revisions?')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response(JSON.stringify([]), { status: 200 });
      if (init?.method === 'POST') {
        written = true;
        return new Response(JSON.stringify({ id: 42, link: 'https://example.com/existing/' }), { status: 200 });
      }
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 42, link: 'https://example.com/existing/', slug: 'existing', status: 'publish',
        modified_gmt: written ? '2026-09-01T01:02:03' : '2026-08-31T01:02:03', title: { raw: 'Old title' },
        content: { raw: written ? `<!-- aiseo-delivery:${deliveryId} -->\n<p>Old</p><p>New</p>` : '<p>Old</p>' }
      }]), { status: 200 });
      return new Response(`<html><!-- aiseo-delivery:${deliveryId} --></html>`, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    await expect(wordPressService.update({
      domain: 'example.com', encrypted, deliveryId, title: 'Old title', html: '<p>Old</p><p>New</p>',
      actionType: 'ADD_CONTENT_SECTION',
      capability: { supported: true, reason: 'classic', strategy: 'CLASSIC_DOM' },
      snapshot: {
        postId: '42', resourceType: 'posts', url: 'https://example.com/existing/', status: 'publish',
        modifiedAt: '2026-08-31T01:02:03', slug: 'existing', title: 'Old title', content: '<p>Old</p>',
        contentChecksum: '279ed9cf4ee53166ea98e845aeb30e6a19a347d9c3511656a450fe1a82c1f271', contentLength: 10,
        editorKind: 'CLASSIC', structureChecksum: 'a'.repeat(64), seoMetadata: {}
      }
    })).resolves.toMatchObject({ postId: '42', snapshot: { title: 'Old title' } });

    const request = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')?.[1] as RequestInit;
    expect(String(request.body)).toContain(`aiseo-delivery:${deliveryId}`);
  });

  it('builds a bounded site inventory with real internal links', async () => {
    const repeated = 'WordPress SEO performance guidance '.repeat(10);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/wp-json')) return new Response(JSON.stringify({ name: 'Example', description: 'SEO services', url: 'https://example.com' }), { status: 200 });
      if (url.includes('/wp-json/wp/v2/settings')) return new Response(JSON.stringify({ title: 'Example', description: 'SEO services', url: 'https://example.com', language: 'en-US' }), { status: 200 });
      if (url.includes('/wp-json/wp/v2/types')) return new Response(JSON.stringify({ post: { rest_base: 'posts', viewable: true }, page: { rest_base: 'pages', viewable: true } }), { status: 200 });
      if (url.includes('/wp-json/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 42,
        link: 'https://example.com/wordpress-seo/',
        slug: 'wordpress-seo',
        status: 'publish',
        title: { raw: 'WordPress SEO Guide' },
        content: { raw: `<p>${repeated}</p><script>ignored()</script>` }
      }]), { status: 200, headers: { 'x-wp-total': '1', 'x-wp-totalpages': '1' } });
      if (url.includes('/wp-json/wp/v2/pages?')) return new Response(JSON.stringify([{
        id: 7,
        link: 'https://example.com/about/',
        slug: 'about',
        status: 'publish',
        title: { rendered: 'About the company' },
        content: { rendered: '<p>Verified company page content for source grounding.</p>' }
      }]), { status: 200, headers: { 'x-wp-total': '1', 'x-wp-totalpages': '1' } });
      return new Response(JSON.stringify([]), { status: 200, headers: { 'x-wp-total': '0', 'x-wp-totalpages': '1' } });
    });
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

  it('classifies builders and blocks unsafe existing-body mutations', async () => {
    const { assertSafeWordPressMutation, detectWordPressEditor, wordpressPageActionCapabilities } = await import('./wordpress');
    const elementor = '<div class="elementor elementor-42"><div class="elementor-widget">Owned layout</div></div>';
    expect(detectWordPressEditor(elementor)).toBe('ELEMENTOR');
    expect(wordpressPageActionCapabilities('ELEMENTOR', elementor).ADD_CONTENT_SECTION.supported).toBe(false);
    expect(() => assertSafeWordPressMutation({
      actionType: 'ADD_CONTENT_SECTION',
      before: {
        postId: '42', resourceType: 'pages', url: 'https://example.com/landing/', status: 'publish', slug: 'landing', title: 'Landing',
        content: elementor, contentChecksum: 'a'.repeat(64), contentLength: elementor.length, editorKind: 'ELEMENTOR', structureChecksum: 'b'.repeat(64), seoMetadata: {}
      },
      afterTitle: 'Landing',
      afterContent: `${elementor}<p>Unsafe append</p>`
    })).toThrow('构建器');
  });

  it('preserves Gutenberg block structure and rejects dynamic or unknown blocks', async () => {
    const { assertSafeWordPressMutation, wordpressPageActionCapabilities, wordpressStructureChecksum } = await import('./wordpress');
    const safe = '<!-- wp:paragraph --><p>Read our guide</p><!-- /wp:paragraph -->';
    const linked = '<!-- wp:paragraph --><p>Read our <a href="https://example.com/guide/">guide</a></p><!-- /wp:paragraph -->';
    const dynamic = '<!-- wp:query {"queryId":1} --><div>Latest</div><!-- /wp:query -->';
    expect(assertSafeWordPressMutation({
      actionType: 'ADD_INTERNAL_LINKS',
      before: {
        postId: '4', resourceType: 'posts', url: 'https://example.com/post/', status: 'publish', slug: 'post', title: 'Post',
        content: safe, contentChecksum: 'a'.repeat(64), contentLength: safe.length, editorKind: 'GUTENBERG', structureChecksum: wordpressStructureChecksum(safe, 'GUTENBERG'), seoMetadata: {}
      },
      afterTitle: 'Post', afterContent: linked
    })).toEqual(['content']);
    expect(wordpressPageActionCapabilities('GUTENBERG', dynamic).CONTENT_REFRESH.supported).toBe(false);
  });

  it('accepts an internal link produced by the SEO pipeline without changing customer-visible text', async () => {
    const [{ insertContextualInternalLinks }, { assertSafeWordPressMutation, wordpressStructureChecksum }] = await Promise.all([
      import('./seoPipeline'),
      import('./wordpress')
    ]);
    const before = '<!-- wp:paragraph --><p>Our WordPress SEO guide explains technical audits and content improvements.</p><!-- /wp:paragraph -->';
    const linked = insertContextualInternalLinks(before, [{
      title: 'WordPress SEO guide',
      url: 'https://example.com/wordpress-seo/'
    }]);
    expect(linked.inserted).toHaveLength(1);
    expect(linked.html).toContain('<a href="https://example.com/wordpress-seo/"');
    expect(assertSafeWordPressMutation({
      actionType: 'ADD_INTERNAL_LINKS',
      before: {
        postId: '4', resourceType: 'posts', url: 'https://example.com/post/', status: 'publish', slug: 'post', title: 'Post',
        content: before, contentChecksum: 'a'.repeat(64), contentLength: before.length, editorKind: 'GUTENBERG', structureChecksum: wordpressStructureChecksum(before, 'GUTENBERG'), seoMetadata: {}
      },
      afterTitle: 'Post',
      afterContent: linked.html
    })).toEqual(['content']);
  });

  it('rejects a full Classic body rewrite that is not a local diff', async () => {
    const { assertSafeWordPressMutation, wordpressStructureChecksum } = await import('./wordpress');
    const before = '<h2>Original service</h2><p>Customer facts pricing support implementation migration integrations reporting.</p>';
    expect(() => assertSafeWordPressMutation({
      actionType: 'CONTENT_REFRESH',
      before: {
        postId: '8', resourceType: 'pages', url: 'https://example.com/service/', status: 'publish', slug: 'service', title: 'Service',
        content: before, contentChecksum: 'a'.repeat(64), contentLength: before.length, editorKind: 'CLASSIC', structureChecksum: wordpressStructureChecksum(before, 'CLASSIC'), seoMetadata: {}
      },
      afterTitle: 'Service', afterContent: '<article><h1>Unrelated replacement</h1><p>Entirely new marketing copy.</p></article>'
    })).toThrow(/局部|覆盖/);
  });

  it('detects AIOSEO only through public REST signals and enables its declared write field', async () => {
    const route = { methods: ['GET', 'POST'], endpoints: [{ methods: ['POST'], args: { title: {}, content: {}, aioseo_meta_data: {} } }] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/wp-json')) return new Response(JSON.stringify({ name: 'Example', namespaces: ['wp/v2', 'aioseo/v1'], routes: { '/wp/v2/posts': route, '/wp/v2/posts/(?P<id>)': route, '/wp/v2/pages': route, '/wp/v2/pages/(?P<id>)': route, '/wp/v2/types': { methods: ['GET'] }, '/wp/v2/media': { methods: ['GET', 'POST'] } } }), { status: 200 });
      if (url.includes('/users/me')) return new Response(JSON.stringify({ id: 7, name: 'Editor', capabilities: { edit_posts: true, edit_published_posts: true, publish_posts: true } }), { status: 200 });
      if (url.includes('/wp/v2/types?')) return new Response(JSON.stringify({ post: { rest_base: 'posts', viewable: true }, product: { rest_base: 'products', viewable: true } }), { status: 200 });
      if (init?.method === 'OPTIONS') return new Response(JSON.stringify({ route: url }), { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{ id: 5, link: 'https://example.com/guide/', title: { raw: 'Guide' }, content: { raw: '<p>Guide body</p>', rendered: '<p>Guide body</p>' }, aioseo_meta_data: { title: 'SEO Guide' } }]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('<html><head><title>SEO Guide</title><meta name="generator" content="WordPress 6.8.2"></head><body></body></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });
    const scan = await wordPressService.scanCompatibility('example.com', encrypted);
    expect(scan.actionCapabilities.UPDATE_TITLE).toMatchObject({ supported: true, strategy: 'AIOSEO_REST' });
    expect((scan.contentTypes.product as { excludedFromMutation: boolean }).excludedFromMutation).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/wp/v2/plugins'))).toBe(false);
  });

  it('requires verified update and trash capabilities before classifying standard WordPress as full-auto', async () => {
    const collectionRoute = { methods: ['GET', 'POST'], endpoints: [{ methods: ['POST'], args: { title: {}, content: {} } }] };
    const itemRoute = { methods: ['GET', 'POST', 'DELETE'], endpoints: [{ methods: ['POST'], args: { title: {}, content: {} } }, { methods: ['DELETE'] }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/wp-json')) return new Response(JSON.stringify({
        name: 'Standard WordPress',
        home: 'https://example.com',
        namespaces: ['wp/v2'],
        routes: {
          '/wp/v2/posts': collectionRoute,
          '/wp/v2/posts/(?P<id>)': itemRoute,
          '/wp/v2/pages': collectionRoute,
          '/wp/v2/pages/(?P<id>)': itemRoute,
          '/wp/v2/types': { methods: ['GET'] },
          '/wp/v2/media': collectionRoute
        }
      }), { status: 200 });
      if (url.includes('/users/me')) return new Response(JSON.stringify({
        id: 7,
        name: 'Editor',
        capabilities: {
          edit_posts: true,
          edit_published_posts: true,
          edit_pages: true,
          edit_published_pages: true,
          publish_posts: true,
          delete_posts: true,
          delete_published_posts: true
        }
      }), { status: 200 });
      if (url.includes('/wp/v2/types?')) return new Response(JSON.stringify({
        post: { rest_base: 'posts', viewable: true },
        page: { rest_base: 'pages', viewable: true }
      }), { status: 200 });
      if (init?.method === 'OPTIONS') return new Response('{}', { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 5, link: 'https://example.com/guide/', title: { raw: 'Guide' }, content: { raw: '<p>Guide body</p>' }
      }]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response(JSON.stringify([{
        id: 8, link: 'https://example.com/about/', title: { raw: 'About' }, content: { raw: '<p>About body</p>' }
      }]), { status: 200 });
      if (url.includes('/about/')) return new Response('<html><title>About</title></html>', { status: 200 });
      return new Response('<html><head><title>Guide</title><meta name="generator" content="WordPress 6.8.2"></head></html>', { status: 200 });
    }));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    const scan = await wordPressService.scanCompatibility('example.com', encrypted);

    expect(scan.mode).toBe('FULL_AUTO');
    expect(scan.actionCapabilities.CREATE_CONTENT.supported).toBe(true);
    expect(scan.actionCapabilities.UPDATE_TITLE.resourceSupport).toEqual({ posts: true, pages: true });
  });

  it('keeps Yoast and multiple SEO-plugin title control read-only', async () => {
    const route = { methods: ['GET', 'POST'], endpoints: [{ methods: ['POST'], args: { title: {}, content: {}, aioseo_meta_data: {} } }] };
    const makeFetch = (namespaces: string[]) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/wp-json')) return new Response(JSON.stringify({ name: 'Example', namespaces, routes: { '/wp/v2/posts': route, '/wp/v2/posts/(?P<id>)': route, '/wp/v2/pages': route, '/wp/v2/pages/(?P<id>)': route, '/wp/v2/types': { methods: ['GET'] }, '/wp/v2/media': { methods: ['GET'] } } }), { status: 200 });
      if (url.includes('/users/me')) return new Response(JSON.stringify({ id: 7, name: 'Editor', capabilities: { edit_posts: true, edit_published_posts: true, publish_posts: true } }), { status: 200 });
      if (url.includes('/wp/v2/types?')) return new Response(JSON.stringify({ post: { rest_base: 'posts', viewable: true } }), { status: 200 });
      if (init?.method === 'OPTIONS') return new Response('{}', { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{ id: 5, link: 'https://example.com/guide/', title: { raw: 'Guide' }, content: { raw: '<p>Guide body</p>' }, yoast_head: '<title>Guide</title>' }]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response('[]', { status: 200 });
      return new Response('<html><title>Guide</title></html>', { status: 200 });
    });
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });
    vi.stubGlobal('fetch', makeFetch(['wp/v2', 'yoast/v1']));
    expect((await wordPressService.scanCompatibility('example.com', encrypted)).actionCapabilities.UPDATE_TITLE.supported).toBe(false);
    vi.stubGlobal('fetch', makeFetch(['wp/v2', 'yoast/v1', 'aioseo/v1']));
    expect((await wordPressService.scanCompatibility('example.com', encrypted)).actionCapabilities.UPDATE_TITLE.reason).toContain('多个 SEO 插件');
  });

  it('classifies a Headless deployment as analysis-only even when REST write routes exist', async () => {
    const route = { methods: ['GET', 'POST'], endpoints: [{ methods: ['POST'], args: { title: {}, content: {} } }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/wp-json')) return new Response(JSON.stringify({
        name: 'Headless CMS',
        home: 'https://frontend.example.net',
        namespaces: ['wp/v2'],
        routes: {
          '/wp/v2/posts': route,
          '/wp/v2/pages': route,
          '/wp/v2/types': { methods: ['GET'] },
          '/wp/v2/media': { methods: ['GET', 'POST'] }
        }
      }), { status: 200 });
      if (url.includes('/users/me')) return new Response(JSON.stringify({ id: 7, name: 'Editor', capabilities: { edit_posts: true, publish_posts: true } }), { status: 200 });
      if (url.includes('/wp/v2/types?')) return new Response(JSON.stringify({ post: { rest_base: 'posts', viewable: true } }), { status: 200 });
      if (init?.method === 'OPTIONS') return new Response('{}', { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([{
        id: 5, link: 'https://example.com/guide/', title: { raw: 'Guide' }, content: { raw: '<p>Guide body</p>' }
      }]), { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response('[]', { status: 200 });
      return new Response('<html><title>Guide</title></html>', { status: 200 });
    }));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });

    const scan = await wordPressService.scanCompatibility('example.com', encrypted);

    expect(scan.mode).toBe('ANALYSIS_ONLY');
    expect(scan.editorSignals).toMatchObject({ headless: true });
    expect(scan.actionCapabilities.CREATE_CONTENT.supported).toBe(false);
    expect(scan.actionCapabilities.CONTENT_REFRESH.supported).toBe(false);
  });

  it('rejects mutations for a custom content type before selecting a WordPress write action', async () => {
    const { wordpressCompatibilityAllows } = await import('./wordpress');
    const supported = { supported: true, reason: 'site route exists', resourceSupport: { posts: true, pages: true } };
    const scan = {
      mode: 'SAFE_AUTO' as const,
      actionCapabilities: {
        CREATE_CONTENT: supported,
        UPDATE_TITLE: supported,
        ADD_CONTENT_SECTION: supported,
        CONTENT_REFRESH: supported,
        ADD_INTERNAL_LINKS: supported,
        DIAGNOSE_ONLY: { supported: true, reason: 'read only' }
      }
    };

    expect(wordpressCompatibilityAllows(scan, 'CONTENT_REFRESH', {
      resourceType: 'portfolio',
      editorKind: 'CLASSIC',
      content: '<p>Portfolio entry</p>'
    })).toMatchObject({ supported: false });
  });

  it('verifies public content when a cache or minifier removes the private delivery comment', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><title>New guide</title></head><body><p>A unique, verified customer outcome is now visible.</p></body></html>',
      { status: 200 }
    )));
    const { wordPressService } = await import('./wordpress');

    const result = await wordPressService.verifyPublic({
      domain: 'example.com',
      url: 'https://example.com/new-guide/',
      actionType: 'CREATE_CONTENT',
      expectedTitle: 'New guide',
      deliveryId: '00000000-0000-4000-8000-000000000042',
      afterContent: '<p>A unique, verified customer outcome is now visible.</p>'
    });

    expect(result).toMatchObject({
      reachable: true,
      titleMatches: true,
      deliveryMarkerVisible: false,
      contentMatches: true,
      mutationMatches: true
    });
  });

  it('returns a pending public verification result when the public page is temporarily unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('temporary network failure');
    }));
    const { wordPressService } = await import('./wordpress');

    await expect(wordPressService.verifyPublic({
      domain: 'example.com',
      url: 'https://example.com/new-guide/',
      actionType: 'CREATE_CONTENT',
      expectedTitle: 'New guide',
      deliveryId: '00000000-0000-4000-8000-000000000042',
      afterContent: '<p>Expected delivery</p>'
    })).resolves.toMatchObject({ reachable: false, status: 0, mutationMatches: false });
  });

  it('creates a remote draft, verifies it, then publishes without duplicate creation', async () => {
    const deliveryId = '00000000-0000-4000-8000-000000000042';
    const writes: Array<Record<string, unknown>> = [];
    let published = false;
    const resource = () => ({
      id: 42, link: 'https://example.com/new-guide/', slug: 'new-guide', status: published ? 'publish' : 'draft',
      modified_gmt: published ? '2026-09-07T01:01:02' : '2026-09-07T01:01:01', title: { raw: 'New guide' },
      content: { raw: `<!-- aiseo-delivery:${deliveryId} -->\n<p>Useful content</p>` }
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/revisions?')) return new Response('[]', { status: 200 });
      if (url.includes('/wp/v2/pages?')) return new Response('[]', { status: 200 });
      if (url.includes('/wp/v2/posts?slug=')) return new Response(JSON.stringify(published ? [resource()] : []), { status: 200 });
      if (url.endsWith('/wp-json/wp/v2/posts') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); writes.push(body);
        return new Response(JSON.stringify({ id: 42, link: 'https://example.com/new-guide/' }), { status: 200 });
      }
      if (url.includes('/wp-json/wp/v2/posts/42') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)); writes.push(body); published = body.status === 'publish';
        return new Response(JSON.stringify({ id: 42, link: 'https://example.com/new-guide/' }), { status: 200 });
      }
      if (url.includes('/wp-json/wp/v2/posts/42')) return new Response(JSON.stringify(resource()), { status: 200 });
      if (url.includes('/wp/v2/posts?')) return new Response(JSON.stringify([resource()]), { status: 200 });
      return new Response(`<html><title>New guide</title><!-- aiseo-delivery:${deliveryId} --></html>`, { status: 200 });
    }));
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });
    const result = await wordPressService.publish({ domain: 'example.com', encrypted, title: 'New guide', slug: 'new-guide', html: '<p>Useful content</p>', deliveryId });
    expect(writes).toEqual([
      expect.objectContaining({ status: 'draft' }),
      { status: 'publish' }
    ]);
    expect(result).toMatchObject({ postId: '42', snapshot: { status: 'publish' }, verification: { reachable: true, titleMatches: true } });
  });

  it('moves AISEO-created content to trash instead of force deleting it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { wordPressService } = await import('./wordpress');
    const encrypted = wordPressService.encrypt({ username: 'editor', applicationPassword: 'abcd efgh' });
    await wordPressService.rollback({ domain: 'example.com', encrypted, postId: '42' });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://example.com/wp-json/wp/v2/posts/42');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('force=true');
  });
});
