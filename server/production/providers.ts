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
    const common = { location_code: input.locationCode, language_code: input.languageCode };
    const [volumeTask, difficultyTask, serpTask, allintitleTask] = await Promise.all([
      dataForSeoLive('keywords_data/google_ads/search_volume/live', { ...common, keywords: [input.keyword] }),
      dataForSeoLive('dataforseo_labs/google/bulk_keyword_difficulty/live', { ...common, keywords: [input.keyword] }),
      dataForSeoLive('serp/google/organic/live/advanced', { ...common, keyword: input.keyword, depth: 20 }),
      dataForSeoLive('serp/google/organic/live/advanced', { ...common, keyword: `allintitle:${input.keyword}`, depth: 10 })
    ]);
    const searchVolume = Number(volumeTask.result?.[0]?.items?.[0]?.search_volume);
    const keywordDifficulty = Number(difficultyTask.result?.[0]?.items?.[0]?.keyword_difficulty);
    const allintitleCount = Number(allintitleTask.result?.[0]?.se_results_count);
    const serp = serpTask.result?.[0];
    const serpEvidenceCount = Array.isArray(serp?.items) ? serp.items.length : 0;
    if (![searchVolume, keywordDifficulty, allintitleCount].every(Number.isFinite)) {
      throw new ExternalServiceError('DataForSEO 未返回完整的搜索量、KD 或 allintitle 数据');
    }
    if (serpEvidenceCount < 1) throw new ExternalServiceError('DataForSEO 未返回可核验的 SERP 结果');
    return { keyword: input.keyword, searchVolume, keywordDifficulty, allintitleCount, serp, serpEvidenceCount, fetchedAt: new Date().toISOString() };
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
    const result = await json(await externalFetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.propertyId)}/searchAnalytics/query`, {
      method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ startDate: input.startDate, endDate: input.endDate, dimensions: ['query', 'page', 'country', 'device'], rowLimit: 25_000, type: 'web' })
    }));
    return { rows: Array.isArray(result.rows) ? result.rows : [] };
  }
};
