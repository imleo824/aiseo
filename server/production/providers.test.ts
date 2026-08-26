import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  integrationConnection: { upsert: vi.fn() }
}));

vi.mock('dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('./prisma', () => ({ prisma: { integrationConnection: mocks.integrationConnection } }));

const savedEnvironment = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnvironment)) delete process.env[name];
  }
  Object.assign(process.env, savedEnvironment);
  global.fetch = originalFetch;
  vi.clearAllMocks();
  vi.resetModules();
});

const configureProviderSecrets = () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  process.env.GSC_STATE_SECRET = 'state-signing-secret';
  process.env.GSC_CLIENT_ID = 'gsc-client';
  process.env.GSC_CLIENT_SECRET = 'gsc-secret';
  process.env.APP_BASE_URL = 'https://app.example.com';
  process.env.DATAFORSEO_LOGIN = 'dfs-login';
  process.env.DATAFORSEO_PASSWORD = 'dfs-password';
  process.env.TRONGRID_API_KEY = 'trongrid-key';
  process.env.TRC20_USDT_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('provider security boundaries', () => {
  it('binds GSC OAuth state to its signed organization and user context', async () => {
    configureProviderSecrets();
    const { signGscState, verifyGscState } = await import('./providers');
    const state = signGscState({ organizationId: 'org-1', userId: 'user-1', siteUrl: 'sc-domain:example.com' });
    expect(verifyGscState(state)).toEqual({ organizationId: 'org-1', userId: 'user-1', siteUrl: 'sc-domain:example.com' });
    expect(() => verifyGscState(`${state}x`)).toThrow('签名无效');
  });

  it('encrypts WordPress credentials before persistence', async () => {
    configureProviderSecrets();
    const { wordPressProvider } = await import('./providers');
    const payload = wordPressProvider.encryptCredentials({ username: 'editor', applicationPassword: 'sensitive app password' });
    expect(payload.includes(Buffer.from('sensitive app password'))).toBe(false);
  });

  it('uses Google read-only OAuth and persists only encrypted refresh credentials', async () => {
    configureProviderSecrets();
    const { gscProvider } = await import('./providers');
    const url = new URL(gscProvider.authorizationUrl('signed-state'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/v1/integrations/gsc/callback');

    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ refresh_token: 'refresh-secret', scope: 'https://www.googleapis.com/auth/webmasters.readonly' }));
    await expect(gscProvider.exchangeCode('authorization-code', 'sc-domain:example.com')).resolves.toEqual({ refreshToken: 'refresh-secret', siteUrl: 'sc-domain:example.com', scope: 'https://www.googleapis.com/auth/webmasters.readonly' });

    await gscProvider.storeConnection('org-1', { refreshToken: 'refresh-secret', siteUrl: 'sc-domain:example.com', scope: 'read-only' });
    const call = mocks.integrationConnection.upsert.mock.calls[0][0];
    expect(call.create.encryptedCredentials).toBeInstanceOf(Buffer);
    expect(call.create.encryptedCredentials.includes(Buffer.from('refresh-secret'))).toBe(false);
    expect(call.create.status).toBe('PENDING');
  });

  it('creates DataForSEO async jobs and distinguishes pending, ready, and failed results', async () => {
    configureProviderSecrets();
    const { dataForSeoProvider } = await import('./providers');
    global.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ tasks: [{ result: [{ id: 'dfs-task-1' }] }] }))
      .mockResolvedValueOnce(jsonResponse({ tasks: [{ status_code: 20100 }] }))
      .mockResolvedValueOnce(jsonResponse({ tasks: [{ status_code: 20000, result: [{ type: 'organic', rank_group: 1 }] }] }))
      .mockResolvedValueOnce(jsonResponse({ tasks: [{ status_code: 50000, status_message: 'provider failed' }] }));
    await expect(dataForSeoProvider.createSerpTask({ keyword: 'seo software', locationCode: 2840, languageCode: 'en', tag: 'job-1' })).resolves.toBe('dfs-task-1');
    await expect(dataForSeoProvider.getSerpTask('dfs-task-1')).resolves.toEqual({ ready: false });
    await expect(dataForSeoProvider.getSerpTask('dfs-task-1')).resolves.toEqual({ ready: true, payload: [{ type: 'organic', rank_group: 1 }] });
    await expect(dataForSeoProvider.getSerpTask('dfs-task-1')).rejects.toThrow('provider failed');
    expect(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers.authorization)).toMatch(/^Basic /);
  });

  it('fails closed without calling external providers when provider secrets are missing', async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    process.env.APP_BASE_URL = 'https://app.example.com';
    global.fetch = vi.fn();

    const { dataForSeoProvider, gscProvider } = await import('./providers');
    expect(() => gscProvider.authorizationUrl('signed-state')).toThrow('GSC OAuth 尚未配置');
    await expect(dataForSeoProvider.getSerpTask('dfs-task-1')).rejects.toThrow('DataForSEO 凭证尚未配置');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts only a confirmed transfer matching hash, recipient, contract and micro amount', async () => {
    configureProviderSecrets();
    const { tronGridProvider } = await import('./providers');
    const input = { txHash: 'a'.repeat(64), recipientAddress: 'TRc20RecipientAddress111111111111111', expectedAmountMicros: 12_000_000n };
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ transaction_id: 'A'.repeat(64), from: 'TFromAddress', to: input.recipientAddress, value: '12000000', token_info: { address: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj' }, block_timestamp: 123 }] }));
    await expect(tronGridProvider.verifyTransfer(input)).resolves.toMatchObject({ transactionId: 'A'.repeat(64), valueMicros: '12000000', confirmed: true });

    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ transaction_id: 'A'.repeat(64), to: input.recipientAddress, value: '1', token_info: { address: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj' } }] }));
    await expect(tronGridProvider.verifyTransfer(input)).rejects.toThrow('金额与充值意图不一致');
  });

  it('rejects private WordPress destinations before credentials can leave the process', async () => {
    configureProviderSecrets();
    mocks.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const { wordPressProvider } = await import('./providers');
    const credentials = wordPressProvider.encryptCredentials({ username: 'editor', applicationPassword: 'app-password' });
    await expect(wordPressProvider.publish({ domain: 'https://wordpress.example', credentials, title: 'Title', html: '<p>Safe</p>' })).rejects.toThrow('私有网络地址');
    expect(global.fetch).toBe(originalFetch);
  });
});
