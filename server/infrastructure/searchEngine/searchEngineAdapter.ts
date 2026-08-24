import { ISearchEngineSubmitter } from '../../domain/ports';
import { logger } from '../../utils/logger';
import { indexingCircuitBreaker } from '../resilience/circuitBreaker';

export class SearchEngineAdapter implements ISearchEngineSubmitter {
  /**
   * 百度站长主动推送 API (严格依赖站点域名与 Token 1对1 绑定)
   */
  public async pushToBaidu(
    siteDomain: string,
    token?: string,
    urls: string[] = []
  ): Promise<{
    success: boolean;
    skipped?: boolean;
    remain?: number;
    successCount?: number;
    notSameSite?: string[];
    notValid?: string[];
    message: string;
  }> {
    if (urls.length === 0) {
      return { success: false, message: '无可提交的 URL 列表' };
    }

    if (!token || !token.trim()) {
      logger.info('SEARCH_ENGINE', `站点 ${siteDomain} 未配置百度 Token，跳过百度主动推送`);
      return {
        success: true,
        skipped: true,
        message: `站点 ${siteDomain} 未配置专属百度 Token，已跳过主动推送，等待百度蜘蛛自然抓取`,
      };
    }

    const cleanToken = token.trim();
    const cleanDomain = siteDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const profiler = logger.profile('SEARCH_ENGINE', `pushToBaidu(${cleanDomain}, ${urls.length} URLs)`);

    return indexingCircuitBreaker.execute(
      async () => {
        const endpoint = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(cleanDomain)}&token=${encodeURIComponent(cleanToken)}`;
        const bodyText = urls.join('\n');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'User-Agent': 'curl/7.68.0'
          },
          body: bodyText,
          signal: controller.signal
        }).catch(err => {
          logger.warn('SEARCH_ENGINE', `Baidu fetch failed: ${err?.message}`);
          return null;
        });
        clearTimeout(timeoutId);

        if (response) {
          const resJson: any = await response.json().catch(() => null);

          if (response.ok && resJson) {
            profiler.done(`Baidu push success (remain: ${resJson.remain || 0})`);
            return {
              success: true,
              skipped: false,
              remain: resJson.remain || 0,
              successCount: resJson.success || urls.length,
              notSameSite: resJson.not_same_site,
              notValid: resJson.not_valid,
              message: `百度 API 实时推送成功！本次推送 ${resJson.success || urls.length} 条，今日剩余配额: ${resJson.remain || 0}`
            };
          } else {
            const errorMsg = resJson?.message || `HTTP ${response.status}`;
            logger.warn('SEARCH_ENGINE', `Baidu returned non-200 (${errorMsg}) for ${cleanDomain}`);
            return { success: false, message: `百度推送失败: ${errorMsg}` };
          }
        }

        profiler.done('Baidu submission failed (network error)');
        return {
          success: false,
          message: `百度推送网络请求失败`
        };
      },
      () => {
        profiler.done('Circuit breaker fallback for Baidu');
        return {
          success: false,
          message: `百度推送熔断保护已生效，请求被拒绝`
        };
      }
    );
  }

  /**
   * Google Indexing API (严格依赖站点 GSC 所有权与 Service Account JSON 密钥)
   */
  public async pushToGoogle(
    siteDomain: string,
    serviceAccountJson?: string,
    urls: string[] = []
  ): Promise<{
    success: boolean;
    skipped?: boolean;
    statusCode?: number;
    message: string;
  }> {
    if (urls.length === 0) {
      return { success: false, message: '无可提交的 URL 列表' };
    }

    if (!serviceAccountJson || !serviceAccountJson.trim()) {
      logger.info('SEARCH_ENGINE', `站点 ${siteDomain} 未配置 Google Service Account，跳过 Google Indexing 推送`);
      return {
        success: true,
        skipped: true,
        message: `站点 ${siteDomain} 未配置 Google Service Account 凭证，已跳过实时推送`,
      };
    }

    const cleanDomain = siteDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const profiler = logger.profile('SEARCH_ENGINE', `pushToGoogle(${cleanDomain}, ${urls.length} URLs)`);

    return indexingCircuitBreaker.execute(
      async () => {
        let clientEmail = '';
        try {
          const creds = JSON.parse(serviceAccountJson);
          clientEmail = creds.client_email || 'service-account';
        } catch {
          logger.warn('SEARCH_ENGINE', `Invalid Google Service Account JSON for ${cleanDomain}`);
          return { success: false, message: 'Google Service Account JSON 格式错误' };
        }

        // Implementation of actual Google API call would go here
        // Returning failure since it's not implemented yet in the mock
        profiler.done('Google Indexing API submission not fully implemented');
        return {
          success: false,
          statusCode: 501,
          message: `Google Indexing API 暂未实现完整逻辑`
        };
      },
      () => {
        profiler.done('Google circuit fallback');
        return {
          success: false,
          statusCode: 503,
          message: `Google Indexing API 熔断保护已生效，请求被拒绝`
        };
      }
    );
  }
}

export const searchEngineAdapter = new SearchEngineAdapter();
export const SearchEnginePushService = searchEngineAdapter;

