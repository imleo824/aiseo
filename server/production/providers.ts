import { createHmac, timingSafeEqual } from 'crypto';
import { lookup } from 'dns/promises';
import { DataSource, DataStatus, type IntegrationConnection } from '@prisma/client';
import { ExternalServiceError, ValidationError } from '../domain/errors';
import { decryptSecret, encryptSecret } from './crypto';
import { env } from './env';
import { prisma } from './prisma';

const responseJson = async (response: Response): Promise<any> => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ExternalServiceError(`外部服务请求失败 (${response.status}): ${body.error?.message || body.status_message || response.statusText}`);
  return body;
};

export type GscCredentials = { refreshToken: string; siteUrl: string; scope: string };

const stateSignature = (value: string) => createHmac('sha256', env.gscStateSecret).update(value).digest('base64url');
export const signGscState = (input: { organizationId: string; userId: string; siteUrl: string }): string => {
  if (!env.gscStateSecret) throw new ValidationError('尚未配置 GSC_STATE_SECRET');
  const body = Buffer.from(JSON.stringify({ ...input, expiresAt: Date.now() + 10 * 60 * 1000 }), 'utf8').toString('base64url');
  return `${body}.${stateSignature(body)}`;
};
export const verifyGscState = (value: string): { organizationId: string; userId: string; siteUrl: string } => {
  const [body, signature] = value.split('.');
  if (!body || !signature) throw new ValidationError('GSC 授权状态无效');
  const expected = stateSignature(body);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ValidationError('GSC 授权状态签名无效');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!parsed.expiresAt || parsed.expiresAt < Date.now()) throw new ValidationError('GSC 授权状态已过期');
  return { organizationId: parsed.organizationId, userId: parsed.userId, siteUrl: parsed.siteUrl };
};

export const gscProvider = {
  authorizationUrl(state: string): string {
    if (!env.gscClientId || !env.gscClientSecret) throw new ValidationError('GSC OAuth 尚未配置');
    const params = new URLSearchParams({ client_id: env.gscClientId, redirect_uri: `${env.appBaseUrl}/api/v1/integrations/gsc/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/webmasters.readonly', state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code: string, siteUrl: string): Promise<GscCredentials> {
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.gscClientId, client_secret: env.gscClientSecret, redirect_uri: `${env.appBaseUrl}/api/v1/integrations/gsc/callback`, grant_type: 'authorization_code' }) });
    const token = await responseJson(response);
    if (!token.refresh_token) throw new ExternalServiceError('Google 未返回刷新令牌；请重新授权并允许离线访问');
    return { refreshToken: token.refresh_token, siteUrl, scope: token.scope || 'https://www.googleapis.com/auth/webmasters.readonly' };
  },

  async storeConnection(organizationId: string, credentials: GscCredentials): Promise<void> {
    await prisma.integrationConnection.upsert({ where: { organizationId_provider: { organizationId, provider: DataSource.GSC } }, create: { organizationId, provider: DataSource.GSC, encryptedCredentials: encryptSecret(credentials), keyVersion: 1, status: DataStatus.PENDING }, update: { encryptedCredentials: encryptSecret(credentials), keyVersion: 1, status: DataStatus.PENDING, lastError: null } });
  },

  async sync(connection: IntegrationConnection): Promise<{ rows: unknown[]; availableFrom: Date }> {
    const credentials = decryptSecret<GscCredentials>(Buffer.from(connection.encryptedCredentials));
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.gscClientId, client_secret: env.gscClientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }) });
    const token = await responseJson(tokenResponse);
    const availableFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const day = availableFrom.toISOString().slice(0, 10);
    const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(credentials.siteUrl)}/searchAnalytics/query`, { method: 'POST', headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ startDate: day, endDate: day, dimensions: ['query', 'page', 'country', 'device'], rowLimit: 25_000, type: 'web' }) });
    const result = await responseJson(response);
    return { rows: result.rows || [], availableFrom };
  }
};

const dataForSeoAuth = () => `Basic ${Buffer.from(`${env.dataForSeoLogin}:${env.dataForSeoPassword}`).toString('base64')}`;
export const dataForSeoProvider = {
  async createSerpTask(input: { keyword: string; locationCode: number; languageCode: string; tag: string }): Promise<string> {
    if (!env.dataForSeoLogin || !env.dataForSeoPassword) throw new ValidationError('DataForSEO 凭证尚未配置');
    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/task_post', { method: 'POST', headers: { authorization: dataForSeoAuth(), 'content-type': 'application/json' }, body: JSON.stringify([{ keyword: input.keyword, location_code: input.locationCode, language_code: input.languageCode, tag: input.tag, depth: 10 }]) });
    const result = await responseJson(response);
    const task = result.tasks?.[0]?.result?.[0];
    if (!task?.id) throw new ExternalServiceError(result.tasks?.[0]?.status_message || 'DataForSEO 未返回任务 ID');
    return task.id;
  },
  async getSerpTask(taskId: string): Promise<{ ready: boolean; payload?: unknown }> {
    const response = await fetch(`https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`, { headers: { authorization: dataForSeoAuth() } });
    const result = await responseJson(response);
    const task = result.tasks?.[0];
    if (task?.status_code === 20000) return { ready: true, payload: task.result };
    if (task?.status_code === 20100 || task?.status_code === 40602) return { ready: false };
    throw new ExternalServiceError(task?.status_message || 'DataForSEO 任务失败');
  }
};

export const tronGridProvider = {
  async verifyTransfer(input: { txHash: string; recipientAddress: string; expectedAmountMicros: bigint }): Promise<Record<string, unknown>> {
    if (!env.tronGridApiKey) throw new ValidationError('TRON Grid API Key 尚未配置');
    const url = new URL(`https://api.trongrid.io/v1/accounts/${input.recipientAddress}/transactions/trc20`);
    url.searchParams.set('only_confirmed', 'true');
    url.searchParams.set('contract_address', env.trc20UsdtContract);
    url.searchParams.set('limit', '200');
    const response = await fetch(url, { headers: { 'TRON-PRO-API-KEY': env.tronGridApiKey } });
    const result = await responseJson(response);
    const transfer = (result.data || []).find((item: any) => item.transaction_id?.toLowerCase() === input.txHash.toLowerCase());
    if (!transfer) throw new ExternalServiceError('未在已固化 TRC20 转账中找到该交易，请稍后重试');
    if (transfer.to !== input.recipientAddress || transfer.token_info?.address !== env.trc20UsdtContract || BigInt(transfer.value) !== input.expectedAmountMicros) throw new ValidationError('交易的收款地址、USDT 合约或金额与充值意图不一致');
    return { transactionId: transfer.transaction_id, from: transfer.from, to: transfer.to, valueMicros: transfer.value, contract: transfer.token_info?.address, blockTimestamp: transfer.block_timestamp, confirmed: true };
  }
};

type WordPressCredentials = { username: string; applicationPassword: string };
const isPrivateAddress = (address: string): boolean => {
  if (address.includes(':')) return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
  const [a, b] = address.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};
const assertPublicWordPressUrl = async (domain: string): Promise<string> => {
  const url = new URL(domain.startsWith('http') ? domain : `https://${domain}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) throw new ValidationError('WordPress 域名必须是公网 HTTPS 域名');
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new ValidationError('WordPress 域名不能解析到私有网络地址');
  return url.origin;
};

export const wordPressProvider = {
  async publish(input: { domain: string; credentials: Buffer; title: string; html: string }): Promise<string> {
    const baseUrl = await assertPublicWordPressUrl(input.domain);
    const credentials = decryptSecret<WordPressCredentials>(input.credentials);
    const authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString('base64')}`;
    const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify({ title: input.title, content: input.html, status: 'publish' }), signal: AbortSignal.timeout(12_000) });
    const result = await responseJson(response);
    if (!result.link) throw new ExternalServiceError('WordPress 未返回文章链接');
    return result.link;
  },
  encryptCredentials(credentials: WordPressCredentials): Buffer {
    if (!credentials.username || !credentials.applicationPassword) throw new ValidationError('必须提供 WordPress 用户名和应用密码');
    return encryptSecret(credentials);
  }
};
