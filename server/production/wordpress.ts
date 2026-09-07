import { ConflictError, ExternalServiceError, ValidationError } from '../domain/errors';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { createHash } from 'crypto';
import { decryptSecret, encryptSecret } from './crypto';
import sanitizeHtml from 'sanitize-html';

export type WordPressCredentials = { username: string; applicationPassword: string };

const authorization = (credentials: WordPressCredentials): string => {
  if (!credentials.username.trim() || !credentials.applicationPassword.trim()) {
    throw new ValidationError('必须提供 WordPress 用户名和应用密码');
  }
  const password = credentials.applicationPassword.replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${credentials.username.trim()}:${password}`).toString('base64')}`;
};

const requestJsonResponse = async <T>(url: string, init: RequestInit): Promise<{ body: T; headers: Headers }> => {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(12_000) });
  if (response.status >= 300 && response.status < 400) {
    throw new ExternalServiceError('WordPress REST API 不允许重定向，请绑定最终 HTTPS 域名');
  }
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : response.statusText;
    throw new ExternalServiceError(`WordPress 请求失败 (${response.status}): ${message}`);
  }
  return { body: body as T, headers: response.headers };
};

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => (await requestJsonResponse<T>(url, init)).body;

type WordPressEditableResource = {
  id?: number;
  link?: string;
  slug?: string;
  status?: string;
  modified_gmt?: string;
  type?: string;
  title?: { raw?: string; rendered?: string };
  excerpt?: { raw?: string; rendered?: string };
  content?: { raw?: string; rendered?: string };
  meta?: Record<string, unknown>;
};

export type WordPressSitePage = {
  wordpressId: string;
  resourceType: string;
  url: string;
  slug: string;
  status: string;
  modifiedAt?: string;
  title: string;
  excerpt: string;
  content: string;
  contentChecksum: string;
  wordCount: number;
  internalLinks: Array<{ url: string; anchor: string }>;
  seoMetadata: Record<string, unknown>;
};

export type WordPressSiteContext = {
  normalizedUrl: string;
  title: string;
  content: string;
  checksum: string;
  fetchedAt: string;
  internalLinks: Array<{ title: string; url: string }>;
  pages: WordPressSitePage[];
  site: { name: string; description: string; locale?: string; url: string };
  inventory: {
    resourceTypes: string[];
    categories: number;
    tags: number;
    media: number;
    categoriesAvailable?: boolean;
    tagsAvailable?: boolean;
    mediaAvailable?: boolean;
  };
};

export type WordPressEditableSnapshot = {
  postId: string;
  resourceType: 'posts' | 'pages';
  url: string;
  status: string;
  modifiedAt?: string;
  slug: string;
  title: string;
  content: string;
  contentChecksum: string;
  contentLength: number;
};

const plainText = (value: string): string => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

const wordCount = (value: string): number => {
  const text = plainText(value);
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return han + words;
};

const comparableUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};

const internalLinksFromHtml = (html: string, origin: string): Array<{ url: string; anchor: string }> => {
  const links = new Map<string, { url: string; anchor: string }>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.protocol !== 'https:' || url.origin !== origin) continue;
      const normalized = comparableUrl(url.toString());
      if (!links.has(normalized)) links.set(normalized, { url: normalized, anchor: plainText(match[2]).slice(0, 200) });
    } catch {
      // Invalid anchors are ignored but remain visible to the OnPage audit.
    }
  }
  return [...links.values()];
};

const MAX_WORDPRESS_RESOURCES = 10_000;
const MAX_WORDPRESS_RESOURCE_TYPES = 20;
const MAX_PAGE_CONTENT_BYTES = 1_000_000;
const MAX_SITE_CONTENT_BYTES = 100_000_000;
const assertDeliveryId = (deliveryId: string): void => {
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId)) throw new ValidationError('WordPress 交付幂等标识无效');
};
const deliveryMarker = (deliveryId: string): string => `<!-- aiseo-delivery:${deliveryId} -->`;

const readAllResources = async <T>(url: URL, headers: Record<string, string>): Promise<T[]> => {
  url.searchParams.set('per_page', '100');
  url.searchParams.set('page', '1');
  const first = await requestJsonResponse<T[]>(url.toString(), { headers });
  if (!Array.isArray(first.body)) throw new ExternalServiceError('WordPress 列表接口返回了无效结构');
  const totalPages = Math.max(1, Number(first.headers.get('x-wp-totalpages') || 1));
  const total = Number(first.headers.get('x-wp-total') || first.body.length);
  if (!Number.isInteger(totalPages) || totalPages > Math.ceil(MAX_WORDPRESS_RESOURCES / 100)
    || !Number.isInteger(total) || total < 0 || total > MAX_WORDPRESS_RESOURCES) {
    throw new ValidationError(`WordPress 内容超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限，请先缩小公开内容范围`);
  }
  const result = [...first.body];
  for (let page = 2; page <= totalPages; page += 4) {
    const batch = await Promise.all(Array.from({ length: Math.min(4, totalPages - page + 1) }, (_, offset) => {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('page', String(page + offset));
      return requestJson<unknown>(pageUrl.toString(), { headers }).then((items) => {
        if (!Array.isArray(items)) throw new ExternalServiceError('WordPress 分页列表返回了无效结构');
        return items as T[];
      });
    }));
    for (const items of batch) result.push(...items);
    if (result.length > MAX_WORDPRESS_RESOURCES) throw new ValidationError(`WordPress 内容超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限`);
  }
  return result;
};

const readOptionalResources = async <T>(url: URL, headers: Record<string, string>): Promise<{ items: T[]; available: boolean }> => {
  try {
    return { items: await readAllResources<T>(url, headers), available: true };
  } catch {
    return { items: [], available: false };
  }
};

export const wordPressService = {
  encrypt(credentials: WordPressCredentials): Buffer {
    authorization(credentials);
    return encryptSecret(credentials);
  },

  decrypt(encrypted: Uint8Array): WordPressCredentials {
    return decryptSecret<WordPressCredentials>(Buffer.from(encrypted));
  },

  async applicationPasswordAuthorizationUrl(domain: string): Promise<string> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const root = await requestJson<{ authentication?: { 'application-passwords'?: { endpoints?: { authorization?: string } } } }>(`${origin}/wp-json`, { headers: { accept: 'application/json' } });
    const endpoint = root.authentication?.['application-passwords']?.endpoints?.authorization;
    if (!endpoint) throw new ValidationError('该 WordPress 站点未公开 Application Password 授权入口，请确认 WordPress 版本和 HTTPS 配置');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new ValidationError('WordPress 返回了不安全或跨站的授权地址');
    return url.toString();
  },

  async inspectSiteHealth(domain: string): Promise<{
    origin: string;
    homepageStatus: number;
    canonical: string | null;
    robots: { status: number; available: boolean; blocksAll: boolean };
    sitemap: { url: string | null; status: number | null; available: boolean };
    restApi: boolean;
  }> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const [homepage, robots, rest] = await Promise.all([
      fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } }),
      fetch(`${origin}/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/plain' } }),
      fetch(`${origin}/wp-json`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/json' } })
    ]);
    if (!homepage.ok) throw new ValidationError(`网站首页不可访问 (${homepage.status})`);
    if (!rest.ok) throw new ValidationError(`WordPress REST API 不可访问 (${rest.status})`);
    const [html, robotsText] = await Promise.all([homepage.text(), robots.ok ? robots.text() : Promise.resolve('')]);
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    let sitemapUrl: string | null = null;
    let sitemapStatus: number | null = null;
    for (const path of ['/wp-sitemap.xml', '/sitemap.xml']) {
      const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/xml,text/xml' } });
      if (response.ok) {
        sitemapUrl = `${origin}${path}`;
        sitemapStatus = response.status;
        break;
      }
      sitemapStatus = response.status;
    }
    return {
      origin,
      homepageStatus: homepage.status,
      canonical: canonicalMatch?.[1] || null,
      robots: {
        status: robots.status,
        available: robots.ok,
        blocksAll: /(?:^|\n)\s*user-agent\s*:\s*\*\s*(?:\r?\n)+(?:[^\n]*\n)*?\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(robotsText)
      },
      sitemap: { url: sitemapUrl, status: sitemapStatus, available: Boolean(sitemapUrl) },
      restApi: rest.ok
    };
  },

  async testConnection(domain: string, encrypted: Uint8Array): Promise<{ user: string; siteName: string }> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, currentUser] = await Promise.all([
      requestJson<Record<string, unknown>>(`${origin}/wp-json`, { headers }),
      requestJson<{ name?: string; slug?: string; capabilities?: Record<string, boolean> }>(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers })
    ]);
    const requiredCapabilities = ['edit_posts', 'publish_posts', 'delete_posts', 'edit_pages', 'publish_pages'] as const;
    const missing = requiredCapabilities.filter((capability) => currentUser.capabilities?.[capability] !== true);
    if (missing.length) {
      throw new ValidationError(`WordPress 账号已认证，但缺少安全发布、更新或回滚所需权限：${missing.join(', ')}`);
    }
    return {
      user: String(currentUser.name || currentUser.slug || credentials.username),
      siteName: String(root.name || domain)
    };
  },

  async inspectTarget(input: { domain: string; encrypted: Uint8Array; targetUrl: string; resourceType?: 'posts' | 'pages' }): Promise<WordPressEditableSnapshot> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const target = new URL(input.targetUrl);
    if (target.protocol !== 'https:' || target.origin !== origin) throw new ValidationError('增长动作目标必须是已验证 WordPress 站点内的 HTTPS URL');
    const slug = decodeURIComponent(target.pathname.split('/').filter(Boolean).at(-1) || '');
    if (!slug) throw new ValidationError('首页或无 slug 页面不能通过自动执行器修改');
    const credentials = this.decrypt(input.encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const fields = '_fields=id,link,slug,status,modified_gmt,title,content';
    const [posts, pages] = await Promise.all([
      input.resourceType === 'pages' ? Promise.resolve([]) : requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers }),
      input.resourceType === 'posts' ? Promise.resolve([]) : requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers })
    ]);
    const candidates = [
      ...posts.map((resource) => ({ resource, resourceType: 'posts' as const })),
      ...pages.map((resource) => ({ resource, resourceType: 'pages' as const }))
    ];
    const matched = candidates.find(({ resource }) => resource.link && comparableUrl(resource.link) === comparableUrl(input.targetUrl));
    if (!matched?.resource.id || !matched.resource.link) throw new ValidationError('WordPress REST API 中未找到与目标 URL 精确匹配的可编辑内容');
    const title = String(matched.resource.title?.raw || matched.resource.title?.rendered || '').trim();
    const content = String(matched.resource.content?.raw || matched.resource.content?.rendered || '');
    return {
      postId: String(matched.resource.id),
      resourceType: matched.resourceType,
      url: matched.resource.link,
      status: String(matched.resource.status || 'unknown'),
      modifiedAt: matched.resource.modified_gmt,
      slug: String(matched.resource.slug || slug),
      title,
      content,
      contentChecksum: createHash('sha256').update(content).digest('hex'),
      contentLength: Buffer.byteLength(content, 'utf8')
    };
  },

  async readSiteContext(domain: string, encrypted: Uint8Array): Promise<WordPressSiteContext> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, settings, types] = await Promise.all([
      requestJson<{ name?: string; description?: string; url?: string; home?: string }>(`${origin}/wp-json`, { headers }),
      requestJson<{ title?: string; description?: string; url?: string; language?: string }>(`${origin}/wp-json/wp/v2/settings?context=edit&_fields=title,description,url,language`, { headers }).catch((): { title?: string; description?: string; url?: string; language?: string } => ({})),
      requestJson<Record<string, { slug?: string; rest_base?: string; viewable?: boolean }>>(`${origin}/wp-json/wp/v2/types?context=edit`, { headers }).catch(() => ({}))
    ]);
    const resourceTypes = [...new Set([
      'posts',
      'pages',
      ...Object.values(types)
        .filter((type) => type.viewable !== false && type.rest_base
          && /^[a-z0-9_-]+$/i.test(type.rest_base)
          && !['media', 'blocks', 'templates', 'navigation'].includes(type.rest_base))
        .map((type) => String(type.rest_base))
    ])];
    if (resourceTypes.length > MAX_WORDPRESS_RESOURCE_TYPES) {
      throw new ValidationError(`WordPress 可公开内容类型超过 ${MAX_WORDPRESS_RESOURCE_TYPES} 个安全上限，已停止自动抓取`);
    }
    const fields = '_fields=id,link,slug,status,modified_gmt,type,title,excerpt,content,meta';
    const [collections, categories, tags, media] = await Promise.all([
      Promise.all(resourceTypes.map(async (resourceType) => ({
        resourceType,
        resources: await readAllResources<WordPressEditableResource>(new URL(`${origin}/wp-json/wp/v2/${encodeURIComponent(resourceType)}?context=edit&status=publish&orderby=modified&order=desc&${fields}`), headers)
      }))),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/categories?context=edit&_fields=id,name,slug,description,count`), headers),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/tags?context=edit&_fields=id,name,slug,description,count`), headers),
      readOptionalResources<Record<string, unknown>>(new URL(`${origin}/wp-json/wp/v2/media?context=edit&status=inherit&_fields=id,slug,title,caption,description,alt_text,media_type,mime_type,source_url`), headers)
    ]);
    const collectedResources = collections.flatMap(({ resourceType, resources: values }) => values.map((resource) => ({ resourceType, resource })));
    if (collectedResources.length > MAX_WORDPRESS_RESOURCES) {
      throw new ValidationError(`WordPress 公开内容总数超过 ${MAX_WORDPRESS_RESOURCES} 条安全上限，请使用企业级分批审计流程`);
    }
    let totalContentBytes = 0;
    const resources = collectedResources
      .map(({ resourceType, resource }) => ({ ...resource, __resourceType: resourceType }))
      .filter((resource): resource is WordPressEditableResource & { __resourceType: string; id: number; link: string } => Boolean(resource.id && resource.link))
      .map((resource) => {
        const content = String(resource.content?.raw || resource.content?.rendered || '');
        const contentBytes = Buffer.byteLength(content, 'utf8');
        if (contentBytes > MAX_PAGE_CONTENT_BYTES) throw new ValidationError(`WordPress 页面 ${resource.link} 超过单页内容安全上限`);
        totalContentBytes += contentBytes;
        if (totalContentBytes > MAX_SITE_CONTENT_BYTES) throw new ValidationError('WordPress 站点内容体积超过自动审计安全上限，请使用企业级分批审计流程');
        return {
          wordpressId: String(resource.id),
          resourceType: String((resource as WordPressEditableResource & { __resourceType?: string }).__resourceType || resource.type || 'posts'),
          title: plainText(String(resource.title?.raw || resource.title?.rendered || resource.slug || resource.link)).slice(0, 200),
          url: comparableUrl(resource.link),
          slug: String(resource.slug || ''),
          status: String(resource.status || 'publish'),
          modifiedAt: resource.modified_gmt,
          excerpt: plainText(String(resource.excerpt?.raw || resource.excerpt?.rendered || '')).slice(0, 2_000),
          content,
          seoMetadata: resource.meta || {}
        };
      });
    const pages: WordPressSitePage[] = resources.map((resource) => ({
      ...resource,
      contentChecksum: createHash('sha256').update(resource.content).digest('hex'),
      wordCount: wordCount(resource.content),
      internalLinks: internalLinksFromHtml(resource.content, origin)
    }));
    const internalLinks = [...new Map(pages.map(({ title, url }) => [url, { title, url }])).values()];
    const taxonomyContent = [...categories.items.map((item) => ({ type: 'CATEGORY', item })), ...tags.items.map((item) => ({ type: 'TAG', item }))]
      .map(({ type, item }) => `[${type}] ${plainText(String(item.name || ''))} ${plainText(String(item.description || ''))}`)
      .join('\n');
    const mediaContent = media.items
      .map((item) => `[MEDIA] ${plainText(String((item.title as { raw?: unknown; rendered?: unknown } | undefined)?.raw || (item.title as { rendered?: unknown } | undefined)?.rendered || item.slug || ''))} ${plainText(String(item.alt_text || ''))} ${plainText(String((item.caption as { raw?: unknown; rendered?: unknown } | undefined)?.raw || (item.caption as { rendered?: unknown } | undefined)?.rendered || ''))}`)
      .join('\n');
    const pageContent = pages
      .map(({ title, url, content: html }) => `[PAGE]\nURL: ${url}\nTITLE: ${title}\nCONTENT: ${plainText(html).slice(0, 20_000)}`)
      .join('\n\n');
    const content = `[SITE]\nNAME: ${plainText(String(settings.title || root.name || ''))}\nDESCRIPTION: ${plainText(String(settings.description || root.description || ''))}\n${taxonomyContent}\n${mediaContent}\n${pageContent}`
      .slice(0, 500_000);
    if (content.length < 100) throw new ValidationError('已验证的 WordPress 站点没有足够的已发布内容用于站点理解');
    return {
      normalizedUrl: origin,
      title: `WordPress content inventory for ${new URL(origin).hostname}`,
      content,
      checksum: createHash('sha256').update(content).digest('hex'),
      fetchedAt: new Date().toISOString(),
      internalLinks,
      pages,
      site: {
        name: String(settings.title || root.name || new URL(origin).hostname),
        description: String(settings.description || root.description || ''),
        locale: settings.language ? String(settings.language) : undefined,
        url: String(settings.url || root.home || root.url || origin)
      },
      inventory: {
        resourceTypes,
        categories: categories.items.length,
        tags: tags.items.length,
        media: media.items.length,
        categoriesAvailable: categories.available,
        tagsAvailable: tags.available,
        mediaAvailable: media.available
      }
    };
  },

  async publish(input: { domain: string; encrypted: Uint8Array; title: string; slug: string; html: string; deliveryId: string }): Promise<{ postId: string; url: string }> {
    assertDeliveryId(input.deliveryId);
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const auth = authorization(credentials);
    const marker = deliveryMarker(input.deliveryId);
    const existing = await requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(input.slug)}&context=edit&status=any&_fields=id,link,content`, { headers: { authorization: auth, accept: 'application/json' } });
    const replay = existing.find((post) => String(post.content?.raw || post.content?.rendered || '').includes(marker));
    if (replay?.id && replay.link) return { postId: String(replay.id), url: String(replay.link) };
    if (existing.length) throw new ConflictError('WordPress 已存在相同 slug 的其他内容，已停止发布以避免误绑定或覆盖');
    const body = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, slug: input.slug, content: `${marker}\n${input.html}`, status: 'publish' })
    });
    if (!body.id || !body.link) throw new ExternalServiceError('WordPress 未返回文章 ID 或链接');
    return { postId: String(body.id), url: String(body.link) };
  },

  async update(input: { domain: string; encrypted: Uint8Array; snapshot: WordPressEditableSnapshot; title: string; html: string; deliveryId: string }): Promise<{ postId: string; url: string; snapshot: WordPressEditableSnapshot }> {
    assertDeliveryId(input.deliveryId);
    if (!/^\d+$/.test(input.snapshot.postId)) throw new ValidationError('WordPress 内容 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const current = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.snapshot.url, resourceType: input.snapshot.resourceType });
    const marker = deliveryMarker(input.deliveryId);
    if (current.content.includes(marker) && current.title === input.title) {
      return { postId: current.postId, url: current.url, snapshot: current };
    }
    if (current.postId !== input.snapshot.postId
      || current.modifiedAt !== input.snapshot.modifiedAt
      || current.contentChecksum !== input.snapshot.contentChecksum) {
      throw new ConflictError('WordPress 页面在执行期间已被修改，已停止写入以保护客户最新内容');
    }
    const body = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/${input.snapshot.resourceType}/${input.snapshot.postId}`, {
      method: 'POST',
      headers: { authorization: authorization(credentials), 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, content: `${marker}\n${input.html}`, status: 'publish' })
    });
    if (!body.id || !body.link) throw new ExternalServiceError('WordPress 更新后未返回内容 ID 或链接');
    const snapshot = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: String(body.link), resourceType: input.snapshot.resourceType });
    return { postId: String(body.id), url: String(body.link), snapshot };
  },

  async restore(input: { domain: string; encrypted: Uint8Array; snapshot: WordPressEditableSnapshot; expectedCurrent?: WordPressEditableSnapshot }): Promise<WordPressEditableSnapshot> {
    if (!/^\d+$/.test(input.snapshot.postId)) throw new ValidationError('WordPress 内容 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    if (input.expectedCurrent) {
      const current = await this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.expectedCurrent.url });
      if (current.postId !== input.expectedCurrent.postId || current.contentChecksum !== input.expectedCurrent.contentChecksum || current.modifiedAt !== input.expectedCurrent.modifiedAt) {
        throw new ConflictError('WordPress 页面在交付后已被客户修改，自动回滚已停止以避免覆盖新内容');
      }
    }
    await requestJson(`${origin}/wp-json/wp/v2/${input.snapshot.resourceType}/${input.snapshot.postId}`, {
      method: 'POST',
      headers: { authorization: authorization(credentials), 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.snapshot.title, content: input.snapshot.content, status: input.snapshot.status })
    });
    return this.inspectTarget({ domain: input.domain, encrypted: input.encrypted, targetUrl: input.snapshot.url });
  },

  async rollback(input: { domain: string; encrypted: Uint8Array; postId: string }): Promise<void> {
    if (!/^\d+$/.test(input.postId)) throw new ValidationError('WordPress 文章 ID 无效');
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const response = await fetch(`${origin}/wp-json/wp/v2/posts/${input.postId}?force=true`, {
      method: 'DELETE',
      headers: { authorization: authorization(credentials), accept: 'application/json' },
      signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 404 || response.status === 410) return;
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      throw new ExternalServiceError(`WordPress 回滚失败 (${response.status}): ${body.message || response.statusText}`);
    }
  }
};
