import { ExternalServiceError, ValidationError } from '../domain/errors';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { decryptSecret, encryptSecret } from './crypto';

export type WordPressCredentials = { username: string; applicationPassword: string };

const authorization = (credentials: WordPressCredentials): string => {
  if (!credentials.username.trim() || !credentials.applicationPassword.trim()) {
    throw new ValidationError('必须提供 WordPress 用户名和应用密码');
  }
  const password = credentials.applicationPassword.replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${credentials.username.trim()}:${password}`).toString('base64')}`;
};

const requestJson = async (url: string, init: RequestInit): Promise<Record<string, any>> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ExternalServiceError(`WordPress 请求失败 (${response.status}): ${body.message || response.statusText}`);
  }
  return body;
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
      requestJson(`${origin}/wp-json`, { headers }),
      requestJson(`${origin}/wp-json/wp/v2/users/me?context=edit`, { headers })
    ]);
    if (currentUser.capabilities?.publish_posts !== true) {
      throw new ValidationError('WordPress 账号已认证，但不具备 publish_posts 权限');
    }
    return {
      user: String(currentUser.name || currentUser.slug || credentials.username),
      siteName: String(root.name || domain)
    };
  },

  async publish(input: { domain: string; encrypted: Uint8Array; title: string; slug: string; html: string }): Promise<{ postId: string; url: string }> {
    const origin = await resolvePublicHttpsOrigin(input.domain);
    const credentials = this.decrypt(input.encrypted);
    const auth = authorization(credentials);
    const existing = await requestJson(`${origin}/wp-json/wp/v2/posts?slug=${encodeURIComponent(input.slug)}&context=edit&status=any`, { headers: { authorization: auth, accept: 'application/json' } });
    if (Array.isArray(existing) && existing[0]?.id && existing[0]?.link) return { postId: String(existing[0].id), url: String(existing[0].link) };
    const body = await requestJson(`${origin}/wp-json/wp/v2/posts`, {
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
