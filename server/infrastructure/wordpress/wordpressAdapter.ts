import { WordPressSite } from '../../../src/types/seo';
import { IWordPressPublisher } from '../../domain/ports';
import { logger } from '../../utils/logger';
import { generateSeoSlug } from '../../utils/validator';
import { sanitizeArticleHtml } from '../../utils/contentSanitizer';
import { resolvePublicHttpsOrigin } from '../../utils/networkSafety';

export class WordPressAdapter implements IWordPressPublisher {
  private isWordPressSite(site: WordPressSite): boolean {
    return (site.siteType || 'WORDPRESS') === 'WORDPRESS';
  }

  private async getBaseEndpoint(site: WordPressSite): Promise<string> {
    return `${await resolvePublicHttpsOrigin(site.domain.trim())}/wp-json`;
  }

  private getAuthHeaders(site: WordPressSite): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SEO-Autopilot-Studio/3.0 (+https://ai.studio)'
    };

    if (site.wpUsername && site.wpAppPassword) {
      const cleanPassword = site.wpAppPassword.replace(/\s+/g, '');
      const token = Buffer.from(`${site.wpUsername.trim()}:${cleanPassword}`).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    } else if (site.wpAppPassword) {
      const token = site.wpAppPassword.trim();
      if (token.includes(':')) {
        headers['Authorization'] = `Basic ${Buffer.from(token).toString('base64')}`;
      } else {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  public async testConnection(site: WordPressSite): Promise<{
    connected: boolean;
    user?: string;
    siteName?: string;
    wpVersion?: string;
    message: string;
  }> {
    if (!this.isWordPressSite(site)) {
      return {
        connected: false,
        message: `站点类型为 ${site.siteType}，不会调用 WordPress REST API。请配置对应站点类型的真实连接器。`
      };
    }
    const profiler = logger.profile('WP_ADAPTER', `testConnection(${site.domain})`);
    const headers = this.getAuthHeaders(site);

    if (!headers['Authorization']) {
      profiler.fail('Missing publishing credentials');
      return {
        connected: false,
        message: '缺少 WordPress 应用密码或发布令牌，不能把公开 REST API 访问视为可发布连接。'
      };
    }

    try {
      const baseEndpoint = await this.getBaseEndpoint(site);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      let rootRes: Response;
      try {
        rootRes = await fetch(baseEndpoint, {
          method: 'GET',
          headers,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!rootRes.ok) {
        profiler.fail(`HTTP ${rootRes.status}`);
        return {
          connected: false,
          message: `HTTP 响应异常 (${rootRes.status} ${rootRes.statusText})`
        };
      }

      const rootData: any = await rootRes.json();
      const meController = new AbortController();
      const meTimeout = setTimeout(() => meController.abort(), 6000);
      let meRes: Response;
      try {
        meRes = await fetch(`${baseEndpoint}/wp/v2/users/me`, {
          method: 'GET',
          headers,
          signal: meController.signal
        });
      } finally {
        clearTimeout(meTimeout);
      }

      if (!meRes.ok) {
        profiler.fail(`Publishing authentication HTTP ${meRes.status}`);
        return {
          connected: false,
          siteName: rootData.name || site.name,
          message: `REST API 可访问，但发布鉴权失败 (${meRes.status})。请检查该站点的应用密码和发布权限。`
        };
      }

      const meData: any = await meRes.json();
      profiler.done(`Connected as ${meData.name || meData.slug}`);
      return {
        connected: true,
        user: meData.name || meData.slug || 'Authenticated User',
        siteName: rootData.name || site.name,
        message: `已成功通过 Application Password 验证，用户 [${meData.name || meData.slug}] 具备文章发布权限！`
      };
    } catch (err: any) {
      profiler.fail(err);
      return {
        connected: false,
        message: `连接超时或无法解析主机: ${err?.message || 'Unknown network error'}`
      };
    }
  }

  public async publishPost(
    site: WordPressSite,
    draft: {
      title: string;
      contentHtml: string;
      category?: string;
      summary?: string;
      status?: 'publish' | 'draft';
      slug?: string;
    }
  ): Promise<{
    success: boolean;
    wpPostId?: number;
    publishedUrl?: string;
    slug?: string;
    date?: string;
    rawResponse?: any;
    error?: string;
  }> {
    if (!this.isWordPressSite(site)) {
      return {
        success: false,
        error: `站点类型为 ${site.siteType}，已阻止 WordPress 发布调用。请配置对应站点类型的真实连接器。`
      };
    }
    const profiler = logger.profile('WP_ADAPTER', `publishPost(${site.domain}, "${draft.title.slice(0, 20)}...")`);
    const headers = this.getAuthHeaders(site);
    const postStatus = draft.status || 'publish';

    if (process.env.NODE_ENV === 'test') {
      logger.info('WP_ADAPTER', `[MOCK/TEST] Simulating successful WordPress publication for ${site.domain}`);
      const slug = draft.slug || generateSeoSlug(draft.title);
      return {
        success: true,
        wpPostId: Math.floor(Math.random() * 10000) + 1,
        publishedUrl: `https://${site.domain}/${slug}/`,
        slug,
        date: new Date().toISOString()
      };
    }

    if (!headers['Authorization']) {
      return {
        success: false,
        error: 'Missing WordPress publishing credentials. Configure an Application Password before publishing.'
      };
    }

    if (headers['Authorization']) {
      try {
        const baseEndpoint = await this.getBaseEndpoint(site);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const targetSlug = draft.slug || generateSeoSlug(draft.title);
        const payload: any = {
          title: draft.title,
          content: sanitizeArticleHtml(draft.contentHtml),
          excerpt: draft.summary || '',
          slug: targetSlug,
          status: postStatus
        };

        const response = await fetch(`${baseEndpoint}/wp/v2/posts`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const postData: any = await response.json();
          const publishedUrl = postData.link || `https://${site.domain}/${postData.slug || postData.id}/`;
          profiler.done(`Published live post ID ${postData.id}`);
          return {
            success: true,
            wpPostId: postData.id,
            publishedUrl,
            slug: postData.slug,
            date: postData.date,
            rawResponse: postData,
          };
        } else {
          const errorJson: any = await response.json().catch(() => ({}));
          const errorMsg = errorJson.message || `WordPress HTTP ${response.status} ${response.statusText}`;
          logger.warn('WP_ADAPTER', `REST API publish failed on ${site.domain}: ${errorMsg}`);
          profiler.fail(errorMsg);
          return { success: false, error: errorMsg };
        }
      } catch (err: any) {
        logger.warn('WP_ADAPTER', `REST API error on ${site.domain}: ${err?.message}`);
        profiler.fail(err?.message);
        return { success: false, error: err?.message };
      }
    }

    // Require Auth Headers for real publishing
    return {
      success: false,
      error: "Missing WordPress Application Password. Cannot publish."
    };
  }

  public async deletePost(site: WordPressSite, wpPostId: number): Promise<{ success: boolean; message: string }> {
    if (!this.isWordPressSite(site)) {
      return {
        success: false,
        message: `站点类型为 ${site.siteType}，已阻止 WordPress 删除调用。请配置对应站点类型的真实连接器。`
      };
    }
    const profiler = logger.profile('WP_ADAPTER', `deletePost(${site.domain}, ${wpPostId})`);
    const headers = this.getAuthHeaders(site);

    if (process.env.NODE_ENV === 'test') {
      return {
        success: true,
        message: `[MOCK/TEST] WordPress 生产站已成功删除文章 ID: ${wpPostId}`
      };
    }

    if (!headers['Authorization']) {
      return { success: false, message: '无法删除：缺失 WordPress 发布凭据' };
    }

    if (headers['Authorization'] && wpPostId) {
      try {
        const baseEndpoint = await this.getBaseEndpoint(site);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(`${baseEndpoint}/wp/v2/posts/${wpPostId}?force=true`, {
          method: 'DELETE',
          headers,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          profiler.done(`Deleted remote WP post ID ${wpPostId}`);
          return {
            success: true,
            message: `WordPress 生产站已成功删除文章 ID: ${wpPostId}`
          };
        } else {
          const err = await response.json().catch(() => ({}));
          const errMsg = err.message || `HTTP ${response.status}`;
          logger.warn('WP_ADAPTER', `Remote delete failed on ${site.domain}: ${errMsg}`);
          return { success: false, message: errMsg };
        }
      } catch (err: any) {
        logger.warn('WP_ADAPTER', `Remote delete network error: ${err?.message}`);
        return { success: false, message: err?.message };
      }
    }

    profiler.fail(`Missing Auth or WP Post ID`);
    return {
      success: false,
      message: `无法删除：缺失应用密码或文章 ID`
    };
  }
}

export const wordPressAdapter = new WordPressAdapter();
export const WordPressService = wordPressAdapter;
