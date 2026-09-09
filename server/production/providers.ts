import { ExternalServiceError, ValidationError } from '../domain/errors';
import { env } from './env';

const externalFetch = (input: RequestInfo | URL, init: RequestInit = {}) => fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(20_000) });
type ProviderRecord = Record<string, unknown>;
type DataForSeoResult = ProviderRecord & { items?: Array<ProviderRecord>; se_results_count?: unknown };
type DataForSeoTask = ProviderRecord & { status_code?: number; status_message?: string; result?: DataForSeoResult[] };
type ProviderBody = ProviderRecord & {
  error?: { message?: unknown };
  status_message?: unknown;
  tasks?: DataForSeoTask[];
  data?: unknown[];
  refresh_token?: unknown;
  scope?: unknown;
  access_token?: unknown;
  rows?: unknown[];
};
const isRecord = (value: unknown): value is ProviderRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const json = async (response: Response): Promise<ProviderBody> => {
  const parsed: unknown = await response.json().catch(() => ({}));
  const body: ProviderBody = isRecord(parsed) ? parsed : {};
  if (!response.ok) throw new ExternalServiceError(`供应商请求失败 (${response.status}): ${String(body.error?.message || body.status_message || response.statusText)}`);
  return body;
};

const dataForSeoHeaders = () => {
  if (!env.dataForSeoLogin || !env.dataForSeoPassword) throw new ValidationError('DataForSEO 尚未配置');
  return { authorization: `Basic ${Buffer.from(`${env.dataForSeoLogin}:${env.dataForSeoPassword}`).toString('base64')}`, 'content-type': 'application/json' };
};

const dataForSeoLive = async (path: string, payload: Record<string, unknown>): Promise<DataForSeoTask> => {
  const response = await externalFetch(`https://api.dataforseo.com/v3/${path}`, { method: 'POST', headers: dataForSeoHeaders(), body: JSON.stringify([payload]) });
  const body = await json(response);
  const task = body.tasks?.[0];
  if (task?.status_code !== 20000) throw new ExternalServiceError(task?.status_message || `DataForSEO ${path} 失败`);
  return task;
};

const dataForSeoBatch = async (path: string, payloads: Record<string, unknown>[]): Promise<DataForSeoTask[]> => {
  if (!payloads.length) return [];
  const response = await externalFetch('https://api.dataforseo.com/v3/' + path, {
    method: 'POST',
    headers: dataForSeoHeaders(),
    body: JSON.stringify(payloads)
  });
  const body = await json(response);
  const tasks = body.tasks || [];
  if (tasks.length !== payloads.length || tasks.some((task) => task.status_code !== 20000)) {
    const failed = tasks.find((task) => task.status_code !== 20000);
    throw new ExternalServiceError(failed?.status_message || 'DataForSEO ' + path + ' 批量任务返回不完整');
  }
  return tasks;
};

const nestedRecord = (value: unknown, key: string): ProviderRecord =>
  isRecord(value) && isRecord(value[key]) ? value[key] as ProviderRecord : {};

const finiteNumber = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const collectPaginatedRows = async <T>(
  requestPage: (startRow: number, rowLimit: number) => Promise<T[]>,
  pageSize = 25_000,
  maximumRows = 250_000
): Promise<T[]> => {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25_000) throw new ValidationError('分页大小必须在 1 到 25000 之间');
  if (!Number.isInteger(maximumRows) || maximumRows < pageSize) throw new ValidationError('最大行数必须不小于分页大小');
  const rows: T[] = [];
  while (true) {
    if (rows.length === maximumRows) {
      const overflow = await requestPage(rows.length, 1);
      if (!Array.isArray(overflow)) throw new ExternalServiceError('供应商分页响应格式无效');
      if (overflow.length) throw new ExternalServiceError(`供应商数据超过安全上限 ${maximumRows} 行，已停止以避免生成不完整结论`);
      return rows;
    }
    const requestedLimit = Math.min(pageSize, maximumRows - rows.length);
    const page = await requestPage(rows.length, requestedLimit);
    if (!Array.isArray(page)) throw new ExternalServiceError('供应商分页响应格式无效');
    if (page.length > requestedLimit) throw new ExternalServiceError('供应商返回的数据页超过请求上限');
    rows.push(...page);
    if (page.length < requestedLimit) return rows;
  }
};

export type KeywordDiscoveryCandidate = {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number | null;
  intent: string | null;
  intentProbability: number | null;
  rank: number | null;
  rankingUrl: string | null;
  sources: string[];
};

export const keywordCandidateFromItem = (item: ProviderRecord, source: string): KeywordDiscoveryCandidate | null => {
  const keywordData = nestedRecord(item, 'keyword_data');
  const keywordInfo = Object.keys(keywordData).length ? nestedRecord(keywordData, 'keyword_info') : nestedRecord(item, 'keyword_info');
  const keywordProperties = Object.keys(keywordData).length ? nestedRecord(keywordData, 'keyword_properties') : nestedRecord(item, 'keyword_properties');
  const searchIntentInfo = Object.keys(keywordData).length ? nestedRecord(keywordData, 'search_intent_info') : nestedRecord(item, 'search_intent_info');
  const keywordIntent = nestedRecord(item, 'keyword_intent');
  const rankedElement = nestedRecord(item, 'ranked_serp_element');
  const serpItem = nestedRecord(rankedElement, 'serp_item');
  const keyword = String(keywordData.keyword || item.keyword || '').trim();
  if (keyword.length < 2 || keyword.length > 200) return null;
  const searchVolume = finiteNumber(keywordInfo.search_volume ?? item.search_volume) || 0;
  const keywordDifficulty = finiteNumber(keywordProperties.keyword_difficulty ?? item.keyword_difficulty) ?? null;
  const intent = String(keywordIntent.label || searchIntentInfo.main_intent || item.main_intent || '').trim() || null;
  const intentProbability = finiteNumber(keywordIntent.probability ?? searchIntentInfo.intent_probability ?? item.intent_probability) ?? null;
  const rank = finiteNumber(serpItem.rank_group ?? item.rank_group) ?? null;
  const rankingUrl = String(serpItem.url || item.url || '').trim() || null;
  return { keyword, searchVolume, keywordDifficulty, intent, intentProbability, rank, rankingUrl, sources: [source] };
};

const mergeKeywordCandidates = (groups: Array<{ source: string; items: ProviderRecord[] }>): KeywordDiscoveryCandidate[] => {
  const byKeyword = new Map<string, KeywordDiscoveryCandidate>();
  for (const group of groups) {
    for (const item of group.items) {
      const candidate = keywordCandidateFromItem(item, group.source);
      if (!candidate) continue;
      const key = candidate.keyword.toLocaleLowerCase().normalize('NFKC');
      const existing = byKeyword.get(key);
      if (!existing) {
        byKeyword.set(key, candidate);
        continue;
      }
      existing.searchVolume = Math.max(existing.searchVolume, candidate.searchVolume);
      existing.keywordDifficulty = candidate.keywordDifficulty ?? existing.keywordDifficulty;
      existing.intent = candidate.intent || existing.intent;
      existing.intentProbability = candidate.intentProbability ?? existing.intentProbability;
      existing.rank = candidate.rank ?? existing.rank;
      existing.rankingUrl = candidate.rankingUrl || existing.rankingUrl;
      existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
    }
  }
  return [...byKeyword.values()].sort((left, right) =>
    right.searchVolume - left.searchVolume || left.keyword.localeCompare(right.keyword)
  );
};

const taskItems = (task: DataForSeoTask): ProviderRecord[] =>
  Array.isArray(task.result?.[0]?.items) ? task.result[0].items.filter(isRecord) : [];

export type KeywordMetrics = {
  keyword: string;
  searchVolume: number;
  keywordDifficulty: number;
  allintitleCount: number;
  serp: unknown;
  serpEvidenceCount: number;
  fetchedAt: string;
};

export const dataForSeoProvider = {
  async scanKeyword(input: { keyword: string; locationCode: number; languageCode: string }): Promise<KeywordMetrics> {
    const result = await this.scanKeywords({ keywords: [input.keyword], locationCode: input.locationCode, languageCode: input.languageCode });
    if (!result[0]) throw new ExternalServiceError('DataForSEO 未返回关键词指标');
    return result[0];
  },

  async scanKeywords(input: { keywords: string[]; locationCode: number; languageCode: string }): Promise<KeywordMetrics[]> {
    const keywords = [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 25);
    if (!keywords.length) return [];
    const common = { location_code: input.locationCode, language_code: input.languageCode };
    const [volumeTask, difficultyTask, serpTasks, allintitleTasks] = await Promise.all([
      dataForSeoLive('keywords_data/google_ads/search_volume/live', { ...common, keywords }),
      dataForSeoLive('dataforseo_labs/google/bulk_keyword_difficulty/live', { ...common, keywords }),
      dataForSeoBatch('serp/google/organic/live/advanced', keywords.map((keyword) => ({ ...common, keyword, depth: 20 }))),
      dataForSeoBatch('serp/google/organic/live/advanced', keywords.map((keyword) => ({ ...common, keyword: 'allintitle:' + keyword, depth: 10 })))
    ]);
    const volumes = new Map(taskItems(volumeTask).map((item) => [String(item.keyword).toLocaleLowerCase().normalize('NFKC'), Number(item.search_volume)]));
    const difficulties = new Map(taskItems(difficultyTask).map((item) => [String(item.keyword).toLocaleLowerCase().normalize('NFKC'), Number(item.keyword_difficulty)]));
    const fetchedAt = new Date().toISOString();
    return keywords.map((keyword, index) => {
      const key = keyword.toLocaleLowerCase().normalize('NFKC');
      const searchVolume = volumes.get(key);
      const keywordDifficulty = difficulties.get(key);
      const serp = serpTasks[index]?.result?.[0];
      const allintitleCount = Number(allintitleTasks[index]?.result?.[0]?.se_results_count);
      const serpEvidenceCount = Array.isArray(serp?.items) ? serp.items.length : 0;
      if (![searchVolume, keywordDifficulty, allintitleCount].every(Number.isFinite)) {
        throw new ExternalServiceError('DataForSEO 未返回完整的搜索量、KD 或 allintitle 数据: ' + keyword);
      }
      if (serpEvidenceCount < 1) throw new ExternalServiceError('DataForSEO 未返回可核验的 SERP 结果: ' + keyword);
      return { keyword, searchVolume: searchVolume!, keywordDifficulty: keywordDifficulty!, allintitleCount, serp, serpEvidenceCount, fetchedAt };
    });
  },

  async discoverKeywords(input: {
    seedKeyword: string;
    locationCode: number;
    languageCode: string;
    targetDomain: string;
    competitorDomains?: string[];
    includeSiteKeywords?: boolean;
  }): Promise<KeywordDiscoveryCandidate[]> {
    const common = { location_code: input.locationCode, language_code: input.languageCode };
    const competitorDomains = [...new Set((input.competitorDomains || []).map((domain) => domain.toLocaleLowerCase()))].slice(0, 5);
    const [suggestions, related, siteKeywords, competitorResults] = await Promise.all([
      dataForSeoLive('dataforseo_labs/google/keyword_suggestions/live', {
        ...common, keyword: input.seedKeyword, include_seed_keyword: true, limit: 30
      }),
      dataForSeoLive('dataforseo_labs/google/related_keywords/live', {
        ...common, keyword: input.seedKeyword, include_seed_keyword: true, depth: 1, limit: 30
      }),
      input.includeSiteKeywords === false
        ? Promise.resolve({ result: [] })
        : dataForSeoLive('dataforseo_labs/google/ranked_keywords/live', {
          ...common, target: input.targetDomain, limit: 30,
          order_by: ['keyword_data.keyword_info.search_volume,desc']
        }).catch(() => ({ result: [] })),
      Promise.all(competitorDomains.map(async (competitorDomain) => {
        const [ranked, gap] = await Promise.all([
          dataForSeoLive('dataforseo_labs/google/ranked_keywords/live', {
            ...common, target: competitorDomain, limit: 30,
            order_by: ['keyword_data.keyword_info.search_volume,desc']
          }),
          dataForSeoLive('dataforseo_labs/google/domain_intersection/live', {
            ...common,
            target1: competitorDomain,
            target2: input.targetDomain,
            intersections: false,
            limit: 30,
            order_by: ['keyword_data.keyword_info.search_volume,desc']
          })
        ]);
        return { ranked, gap };
      }))
    ]);
    const merged = mergeKeywordCandidates([
      { source: 'KEYWORD_SUGGESTIONS', items: taskItems(suggestions) },
      { source: 'RELATED_KEYWORDS', items: taskItems(related) },
      { source: 'SITE_RANKED_KEYWORDS', items: taskItems(siteKeywords) },
      ...competitorResults.flatMap(({ ranked, gap }) => [
        { source: 'COMPETITOR_RANKED_KEYWORDS', items: taskItems(ranked) },
        { source: 'COMPETITOR_GAP', items: taskItems(gap) }
      ])
    ]);
    const seedKey = input.seedKeyword.toLocaleLowerCase().normalize('NFKC');
    if (!merged.some((candidate) => candidate.keyword.toLocaleLowerCase().normalize('NFKC') === seedKey)) {
      merged.unshift({
        keyword: input.seedKeyword,
        searchVolume: 0,
        keywordDifficulty: null,
        intent: null,
        intentProbability: null,
        rank: null,
        rankingUrl: null,
        sources: ['USER_SEED']
      });
    }
    const top = merged.slice(0, 25);
    if (!top.length) return [];
    const intentTask = await dataForSeoLive('dataforseo_labs/google/search_intent/live', {
      language_code: input.languageCode,
      keywords: top.map(({ keyword }) => keyword)
    });
    const intents = new Map(taskItems(intentTask).flatMap((item) => {
      const candidate = keywordCandidateFromItem(item, 'SEARCH_INTENT');
      return candidate ? [[candidate.keyword.toLocaleLowerCase().normalize('NFKC'), candidate] as const] : [];
    }));
    return top.map((candidate) => {
      const intent = intents.get(candidate.keyword.toLocaleLowerCase().normalize('NFKC'));
      return {
        ...candidate,
        intent: intent?.intent || candidate.intent,
        intentProbability: intent?.intentProbability ?? candidate.intentProbability,
        sources: intent ? [...new Set([...candidate.sources, 'SEARCH_INTENT'])] : candidate.sources
      };
    });
  },

  async auditPages(urls: string[]): Promise<Array<{ url: string; evidence: Record<string, unknown> }>> {
    const unique = [...new Set(urls)];
    if (unique.length > 500) {
      throw new ValidationError('站点超过 500 个公开页面，已停止自动修改；请使用企业级分批审计流程');
    }
    const audits: Array<{ url: string; evidence: Record<string, unknown> }> = [];
    for (let index = 0; index < unique.length; index += 20) {
      const batchUrls = unique.slice(index, index + 20);
      const tasks = await dataForSeoBatch('on_page/instant_pages', batchUrls.map((url) => ({
        url,
        enable_javascript: false,
        load_resources: false
      })));
      tasks.forEach((task, offset) => {
        audits.push({ url: batchUrls[offset], evidence: task.result?.[0] || {} });
      });
    }
    return audits;
  }
};

export const tronGridProvider = {
  async verifyTransfer(input: { txHash: string; recipientAddress: string; expectedAmountMicros: bigint; notBefore: Date; notAfter: Date }) {
    if (!env.tronGridApiKey) throw new ValidationError('TronGrid 尚未配置');
    const url = new URL(`https://api.trongrid.io/v1/accounts/${input.recipientAddress}/transactions/trc20`);
    url.searchParams.set('only_confirmed', 'true');
    url.searchParams.set('contract_address', env.trc20UsdtContract);
    url.searchParams.set('min_timestamp', String(input.notBefore.getTime()));
    url.searchParams.set('max_timestamp', String(input.notAfter.getTime()));
    url.searchParams.set('limit', '200');
    const result = await json(await externalFetch(url, { headers: { 'TRON-PRO-API-KEY': env.tronGridApiKey } }));
    const transfer = (result.data || []).filter(isRecord).find((item) => String(item.transaction_id).toLowerCase() === input.txHash.toLowerCase());
    if (!transfer) throw new ExternalServiceError('已固化区块中尚未找到该 TRC20 交易');
    const timestamp = Number(transfer.block_timestamp);
    const tokenInfo = isRecord(transfer.token_info) ? transfer.token_info : {};
    if (transfer.to !== input.recipientAddress || tokenInfo.address !== env.trc20UsdtContract) throw new ValidationError('交易收款地址或 USDT 合约不匹配');
    if (!/^\d+$/.test(String(transfer.value)) || BigInt(String(transfer.value)) !== input.expectedAmountMicros) throw new ValidationError('链上金额与应付的六位小数金额不一致');
    if (timestamp < input.notBefore.getTime() || timestamp > input.notAfter.getTime()) throw new ValidationError('交易时间不在充值意图有效窗口内');
    return { transactionId: String(transfer.transaction_id), from: String(transfer.from), to: String(transfer.to), valueMicros: String(transfer.value), contract: String(tokenInfo.address), blockTimestamp: timestamp, confirmed: true };
  }
};

export const gscProvider = {
  authorizationUrl(state: string): string {
    if (!env.gscClientId || !env.gscClientSecret) throw new ValidationError('GSC OAuth 尚未配置');
    const params = new URLSearchParams({ client_id: env.gscClientId, redirect_uri: `${env.appBaseUrl}/api/v1/integrations/gsc/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/webmasters.readonly', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code: string): Promise<{ refreshToken: string; scope: string }> {
    if (!env.gscClientId || !env.gscClientSecret) throw new ValidationError('GSC OAuth 尚未配置');
    const token = await json(await externalFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.gscClientId, client_secret: env.gscClientSecret, redirect_uri: `${env.appBaseUrl}/api/v1/integrations/gsc/callback`, grant_type: 'authorization_code' })
    }));
    if (!token.refresh_token) throw new ExternalServiceError('Google 未返回 refresh_token，请重新授权离线访问');
    return { refreshToken: String(token.refresh_token), scope: String(token.scope || 'https://www.googleapis.com/auth/webmasters.readonly') };
  },

  async sync(input: { refreshToken: string; propertyId: string; startDate: string; endDate: string }) {
    if (!env.gscClientId || !env.gscClientSecret) throw new ValidationError('GSC OAuth 尚未配置');
    const token = await json(await externalFetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.gscClientId, client_secret: env.gscClientSecret, refresh_token: input.refreshToken, grant_type: 'refresh_token' })
    }));
    if (!token.access_token) throw new ExternalServiceError('Google 未返回有效的 GSC access token');
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.propertyId)}/searchAnalytics/query`;
    const rows = await collectPaginatedRows(async (startRow, rowLimit) => {
      const result = await json(await externalFetch(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate: input.startDate,
          endDate: input.endDate,
          dimensions: ['query', 'page', 'country', 'device'],
          rowLimit,
          startRow,
          dataState: 'final',
          type: 'web'
        })
      }));
      return Array.isArray(result.rows) ? result.rows : [];
    });
    return { rows };
  }
};
