import { ExternalServiceError, ValidationError } from '../domain/errors';
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

const requestJson = async <T>(url: string, init: RequestInit): Promise<T> => {
  const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(12_000) });
  if (response.status >= 300 && response.status < 400) {
    throw new ExternalServiceError('WordPress REST API 不允许重定向，请绑定最终 HTTPS 域名');
  }
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body ? String(body.message) : response.statusText;
    throw new ExternalServiceError(`WordPress 请求失败 (${response.status}): ${message}`);
  }
  return body as T;
};

type WordPressEditableResource = {
  id?: number;
  link?: string;
  slug?: string;
  status?: string;
  modified_gmt?: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string; rendered?: string };
};

export type WordPressSiteContext = {
  normalizedUrl: string;
  title: string;
  content: string;
  checksum: string;
  fetchedAt: string;
  internalLinks: Array<{ title: string; url: string }>;
};

const plainText = (value: string): string => sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();

const comparableUrl = (value: string): string => {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
};

export const wordPressService = {
  encrypt(credentials: WordPressCredentials): Buffer {
    authorization(credentials);
    return encryptSecret(credentials);
  },

  decrypt(encrypted: Uint8Array): WordPressCredentials {
    return decryptSecret<WordPressCredentials>(Buffer.from(encrypted));
  },

  async testConnection(domain: string, encrypted: Uint8Array): Promise<{ user: string; siteName: string }> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const [root, currentUser] = await Promise.all([
      requestJson<Record<string, unknown>>(`${origin}/wp-json`, { headers }),
      requestJson<{ name?: string; slug?: string; capabilities?: { publish_posts?: boolean } }>(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers })
    ]);
    if (currentUser.capabilities?.publish_posts !== true) {
      throw new ValidationError('WordPress 账号已认证，但不具备 publish_posts 权限');
    }
    return {
      user: String(currentUser.name || currentUser.slug || credentials.username),
      siteName: String(root.name || domain)
    };
  },

  async inspectTarget(input: { domain: string; encrypted: Uint8Array; targetUrl: string }): Promise<{
    postId: string;
    resourceType: 'posts' | 'pages';
    url: string;
    status: string;
    modifiedAt?: string;
    title: string;
    contentChecksum: string;
    contentLength: number;
  }> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const target = new URL(input.targetUrl);
    if (target.protocol !== 'https:' || target.origin !== origin) throw new ValidationError('增长动作目标必须是已验证 WordPress 站点内的 HTTPS URL');
    const slug = decodeURIComponent(target.pathname.split('/').filter(Boolean).at(-1) || '');
    if (!slug) throw new ValidationError('首页或无 slug 页面不能通过自动执行器修改');
    const credentials = this.decrypt(input.encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const fields = '_fields=id,link,slug,status,modified_gmt,title,content';
    const [posts, pages] = await Promise.all([
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers }),
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&context=edit&status=any&${fields}`, { headers })
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
      title,
      contentChecksum: createHash('sha256').update(content).digest('hex'),
      contentLength: Buffer.byteLength(content, 'utf8')
    };
  },

  async readSiteContext(domain: string, encrypted: Uint8Array): Promise<WordPressSiteContext> {
    const origin = await resolvePublicHttpsOrigin(domain);
    const credentials = this.decrypt(encrypted);
    const headers = { authorization: authorization(credentials), accept: 'application/json' };
    const fields = '_fields=id,link,slug,status,modified_gmt,title,content';
    const [posts, pages] = await Promise.all([
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?context=edit&status=publish&per_page=20&orderby=modified&order=desc&${fields}`, { headers }),
      requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/pages?context=edit&status=publish&per_page=20&orderby=modified&order=desc&${fields}`, { headers })
    ]);
    const resources = [...posts, ...pages]
      .filter((resource): resource is WordPressEditableResource & { id: number; link: string } => Boolean(resource.id && resource.link))
      .map((resource) => ({
        title: plainText(String(resource.title?.raw || resource.title?.rendered || resource.slug || resource.link)).slice(0, 200),
        url: comparableUrl(resource.link),
        body: plainText(String(resource.content?.raw || resource.content?.rendered || '')).slice(0, 20_000)
      }));
    const internalLinks = [...new Map(resources.map(({ title, url }) => [url, { title, url }])).values()].slice(0, 40);
    const content = resources.map(({ title, url, body }) => `[PAGE]\nURL: ${url}\nTITLE: ${title}\nCONTENT: ${body}`).join('\n\n').slice(0, 200_000);
    if (content.length < 100) throw new ValidationError('已验证的 WordPress 站点没有足够的已发布内容用于站点理解');
    return {
      normalizedUrl: origin,
      title: `WordPress content inventory for ${new URL(origin).hostname}`,
      content,
      checksum: createHash('sha256').update(content).digest('hex'),
      fetchedAt: new Date().toISOString(),
      internalLinks
    };
  },

  async publish(input: { domain: string; encrypted: Uint8Array; title: string; slug: string; html: string }): Promise<{ postId: string; url: string }> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const auth = authorization(credentials);
    const existing = await requestJson<WordPressEditableResource[]>(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(input.slug)}&context=edit&status=any`, { headers: { authorization: auth, accept: 'application/json' } });
    if (Array.isArray(existing) && existing[0]?.id && existing[0]?.link) return { postId: String(existing[0].id), url: String(existing[0].link) };
    const body = await requestJson<{ id?: number; link?: string }>(`${origin}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, slug: input.slug, content: input.html, status: 'publish' })
    });
    if (!body.id || !body.link) throw new ExternalServiceError('WordPress 未返回文章 ID 或链接');
    return { postId: String(body.id), url: String(body.link) };
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
