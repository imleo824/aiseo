import type { SiteType, WordPressSite } from '../../../src/types/seo';
import type { IWordPressPublisher } from '../../domain/ports';
import { wordPressAdapter } from '../wordpress/wordpressAdapter';

/**
 * The UI historically called every connected property a "WordPress site".
 * This router is the single boundary that turns a site's declared type into a
 * publishing integration. Never let a non-WordPress site fall through to the
 * WordPress REST client merely because it has a domain.
 */
export const resolvedSiteType = (site: Pick<WordPressSite, 'siteType'>): SiteType => site.siteType || 'WORDPRESS';

export const publishingProviderLabel = (site: Pick<WordPressSite, 'siteType'>): string => {
  switch (resolvedSiteType(site)) {
    case 'SHOPIFY': return 'Shopify';
    case 'GHOST': return 'Ghost';
    case 'WEBFLOW': return 'Webflow';
    case 'CUSTOM_REST': return 'Custom REST';
    case 'WORDPRESS': return 'WordPress';
    default: return String(site.siteType || '未知站点类型');
  }
};

export const publishingNotConfiguredMessage = (site: Pick<WordPressSite, 'siteType'>): string =>
  `${publishingProviderLabel(site)} 发布连接器尚未接入。该站点不会调用 WordPress API；请先配置对应的真实连接器。`;

export type PublishingReadiness = {
  ready: boolean;
  provider: string;
  reason?: string;
};

const unsupportedPublisher = (site: WordPressSite): IWordPressPublisher => ({
  async testConnection() {
    return { connected: false, message: publishingNotConfiguredMessage(site) };
  },
  async publishPost() {
    return { success: false, error: publishingNotConfiguredMessage(site) };
  },
  async deletePost() {
    return { success: false, message: publishingNotConfiguredMessage(site) };
  }
});

export class PublishingAdapterRouter {
  public supports(site: WordPressSite): boolean {
    return resolvedSiteType(site) === 'WORDPRESS';
  }

  public forSite(site: WordPressSite): IWordPressPublisher {
    return this.supports(site) ? wordPressAdapter : unsupportedPublisher(site);
  }

  /**
   * Run before consuming credits or generating paid content. A publish request
   * is only real when its connector was successfully tested and has the
   * credentials required by that connector.
   */
  public readiness(site: WordPressSite): PublishingReadiness {
    const provider = publishingProviderLabel(site);
    if (!this.supports(site)) {
      return { ready: false, provider, reason: publishingNotConfiguredMessage(site) };
    }
    if (!site.wpAppPassword?.trim()) {
      return { ready: false, provider, reason: 'WordPress 应用密码未配置，自动化不会生成或扣点。' };
    }
    if (site.connectorStatus !== 'CONNECTED') {
      return { ready: false, provider, reason: 'WordPress 连接尚未通过真实连通性测试，自动化不会生成或扣点。' };
    }
    return { ready: true, provider };
  }
}

export const publishingAdapterRouter = new PublishingAdapterRouter();
