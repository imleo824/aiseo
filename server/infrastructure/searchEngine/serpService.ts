import { KeywordOpportunityItem } from '../../../src/types/seo';
import { ExternalServiceError } from '../../domain/errors';
import { logger } from '../../utils/logger';

export interface SerpScanRequest {
  seedKeyword: string;
  location?: string;
  numResults?: number;
}

export interface SerpScanResult {
  source: 'FREE_GOOGLE_SUGGEST' | 'FREE_GOOGLE_CSE' | 'PAID_SERP_API';
  query: string;
  opportunities: KeywordOpportunityItem[];
  scannedAt: string;
  tierUsed: string;
  quotaStatus: {
    freeQuotaRemainingToday: number;
    totalFreeUsedThisMonth: number;
    usingPaidTier: boolean;
  };
}

type OrganicResult = { title?: string; link?: string; snippet?: string };

const forumHost = (value: string): boolean => /(^|\.)(reddit\.com|quora\.com|zhihu\.com|v2ex\.com|stackoverflow\.com)$/i.test(value);

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * This legacy-compatible scanner deliberately reports only what a provider
 * returned. Search volume, keyword difficulty, KGR and ROI require a provider
 * that supplies those fields (DataForSEO in the production API), so this adapter never
 * invents them from suggestions or organic-result counts.
 */
export class SerpService {
  private readonly serperApiKey = process.env.SERPER_API_KEY || process.env.SERPER_FREE_API_KEY || process.env.SERPER_PAID_API_KEY;
  private readonly googleCseKey = process.env.GOOGLE_CSE_KEY;
  private readonly googleCseCx = process.env.GOOGLE_CSE_CX;

  async scanKeywordOpportunities(req: SerpScanRequest): Promise<SerpScanResult> {
    const seed = req.seedKeyword.trim();
    if (!seed) throw new ExternalServiceError('种子关键词不能为空');

    if (this.serperApiKey) {
      const opportunities = await this.fetchFromSerper(seed);
      return this.result('PAID_SERP_API', seed, opportunities, 'Serper 实时 SERP 查询', true);
    }

    if (this.googleCseKey && this.googleCseCx) {
      const opportunities = await this.fetchFromGoogleCse(seed);
      return this.result('FREE_GOOGLE_CSE', seed, opportunities, 'Google Custom Search 实时查询', false);
    }

    const opportunities = await this.fetchFromGoogleSuggest(seed);
    return this.result('FREE_GOOGLE_SUGGEST', seed, opportunities, 'Google Suggest 实时建议词（不含搜索量/难度）', false);
  }

  private result(source: SerpScanResult['source'], query: string, opportunities: KeywordOpportunityItem[], tierUsed: string, usingPaidTier: boolean): SerpScanResult {
    if (!opportunities.length) throw new ExternalServiceError('供应商未返回可展示的关键词或 SERP 结果');
    return {
      source,
      query,
      opportunities,
      scannedAt: new Date().toISOString(),
      tierUsed,
      quotaStatus: {
        // Provider-specific quotas cannot be inferred reliably from a request.
        freeQuotaRemainingToday: 0,
        totalFreeUsedThisMonth: 0,
        usingPaidTier
      }
    };
  }

  private unavailableMetrics(keyword: string, label: string, evidence: string[]): KeywordOpportunityItem {
    return {
      id: `serp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      keyword,
      searchVolume: 0,
      kd: 0,
      kgrIndex: 0,
      serpVulnerabilityScore: 0,
      commercialIntentScore: 0,
      roiScore: 0,
      vulnerabilityType: 'PAIN_POINT_LONGTAIL',
      vulnerabilityLabel: label,
      serpWeaknesses: evidence,
      recommendedTitle: '',
      recommendedAngle: '尚未连接可提供搜索量、关键词难度与竞争分析的数据源，不能生成可售的 SEO 结论。',
      recommendedH2s: [],
      searchIntent: 'INFORMATIONAL'
    };
  }

  private async fetchFromGoogleSuggest(seed: string): Promise<KeywordOpportunityItem[]> {
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(seed)}`;
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'AISEO/1.0 (+https://aiseo.example)' } }, 5_000);
    if (!response.ok) throw new ExternalServiceError(`Google Suggest 请求失败: HTTP ${response.status}`);
    const data = await response.json() as unknown[];
    const suggestions = Array.isArray(data[1]) ? data[1].filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    return [...new Set([seed, ...suggestions])].slice(0, 10).map((keyword) => this.unavailableMetrics(
      keyword,
      'Google Suggest 建议词（量化指标未接入）',
      [`Google Suggest 于本次请求返回该建议词：${keyword}`, '未连接 DataForSEO，搜索量、KD、KGR、ROI 均不可用。']
    ));
  }

  private async fetchFromSerper(seed: string): Promise<KeywordOpportunityItem[]> {
    const response = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': this.serperApiKey!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: seed, gl: 'us', hl: 'en', num: 10 })
    });
    if (!response.ok) throw new ExternalServiceError(`Serper API 请求失败: HTTP ${response.status}`);
    const data = await response.json() as { organic?: OrganicResult[] };
    return this.observedSerpOpportunity(seed, data.organic || [], 'Serper');
  }

  private async fetchFromGoogleCse(seed: string): Promise<KeywordOpportunityItem[]> {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', this.googleCseKey!);
    url.searchParams.set('cx', this.googleCseCx!);
    url.searchParams.set('q', seed);
    const response = await fetchWithTimeout(url.toString(), {});
    if (!response.ok) throw new ExternalServiceError(`Google Custom Search 请求失败: HTTP ${response.status}`);
    const data = await response.json() as { items?: OrganicResult[] };
    return this.observedSerpOpportunity(seed, data.items || [], 'Google Custom Search');
  }

  private observedSerpOpportunity(seed: string, results: OrganicResult[], provider: string): KeywordOpportunityItem[] {
    const hosts = results
      .map((item) => {
        try { return item.link ? new URL(item.link).hostname : ''; } catch { return ''; }
      })
      .filter(Boolean);
    const forums = hosts.filter(forumHost);
    const evidence = [
      `${provider} 本次返回 ${results.length} 条自然结果。`,
      forums.length ? `其中 ${forums.length} 条来自论坛/问答域名：${[...new Set(forums)].join(', ')}。` : '本次结果中未识别到预设论坛/问答域名。',
      '未连接 DataForSEO，搜索量、KD、KGR、ROI 均不可用。'
    ];
    logger.info('SERP_SERVICE', `${provider} returned ${results.length} organic results for "${seed}"`);
    return [this.unavailableMetrics(seed, `${provider} 观察结果（量化指标未接入）`, evidence)];
  }
}

export const serpService = new SerpService();
