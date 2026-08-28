import { afterEach, describe, expect, it, vi } from 'vitest';

const savedEnvironment = { ...process.env };

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnvironment)) delete process.env[name];
  }
  Object.assign(process.env, savedEnvironment);
  vi.resetModules();
});

const setCoreProductionEnvironment = (encryptionKey = Buffer.alloc(32, 7).toString('base64')) => {
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_APP_URL = 'postgresql://app_backend:password@db.example.com:5432/postgres?sslmode=require';
  process.env.DATABASE_WORKER_URL = 'postgresql://app_worker:password@db.example.com:5432/postgres?sslmode=require';
  process.env.REDIS_URL = 'rediss://redis.example.com:6380';
  process.env.APP_ENCRYPTION_KEY = encryptionKey;
  process.env.APP_BASE_URL = 'https://app.example.com';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret';
  process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
};

const setProviderEnvironment = () => {
  process.env.GSC_CLIENT_ID = 'client-id';
  process.env.GSC_CLIENT_SECRET = 'client-secret';
  process.env.DATAFORSEO_LOGIN = 'dataforseo-login';
  process.env.DATAFORSEO_PASSWORD = 'dataforseo-password';
  process.env.TRONGRID_API_KEY = 'trongrid-key';
  process.env.TRC20_RECIPIENT_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
};

describe('production configuration guard', () => {
  it('fails closed when dedicated production database roles are absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_APP_URL;
    delete process.env.DATABASE_WORKER_URL;
    const config = await import('./env');
    expect(() => config.assertProductionConfiguration()).toThrow('DATABASE_APP_URL');
    expect(config.productionConfigurationStatus().runtime.databaseBackedApi).toBe(false);
    expect(config.productionConfigurationWarnings()).toContain('DATABASE_APP_URL is not set; the Web service cannot enforce the dedicated non-BYPASSRLS role.');
  });

  it('rejects malformed positive integer settings', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PAYMENT_INTENT_MINUTES = '0';
    await expect(import('./env')).rejects.toThrow('PAYMENT_INTENT_MINUTES must be a positive integer');
  });

  it('requires core production configuration and a 32-byte envelope key', async () => {
    setCoreProductionEnvironment('short-key');
    const invalid = await import('./env');
    expect(() => invalid.assertProductionConfiguration()).toThrow('32-byte');

    vi.resetModules();
    setCoreProductionEnvironment();
    const valid = await import('./env');
    expect(() => valid.assertProductionConfiguration()).not.toThrow();
    expect(valid.env.appBaseUrl).toBe('https://app.example.com');
    expect(valid.env.encryptionKeyFingerprint).toHaveLength(12);
  });

  it('allows missing optional providers during boot but reports them as disabled', async () => {
    setCoreProductionEnvironment();
    delete process.env.GSC_CLIENT_ID;
    delete process.env.GSC_CLIENT_SECRET;
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    delete process.env.TRONGRID_API_KEY;
    delete process.env.TRC20_RECIPIENT_ADDRESS;

    const config = await import('./env');
    expect(() => config.assertProductionConfiguration()).not.toThrow();
    expect(config.productionConfigurationStatus().providers).toEqual({ gsc: false, dataForSeo: false, trc20Payments: false });
    expect(config.productionConfigurationWarnings()).toContain('GSC OAuth is not configured; GSC connection endpoints will fail closed.');
    expect(config.productionConfigurationWarnings()).toContain('DataForSEO is not configured; SERP jobs will fail closed.');
    expect(config.productionConfigurationWarnings()).toContain('TRC20 payment verification is not configured; recharge endpoints will fail closed.');
    expect(config.productionConfigurationStatus().runtime.databaseBackedApi).toBe(true);
  });

  it('uses Railway public domain as APP_BASE_URL when not set explicitly', async () => {
    setCoreProductionEnvironment();
    setProviderEnvironment();
    delete process.env.APP_BASE_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'aiseo.up.railway.app';

    const config = await import('./env');
    expect(config.env.appBaseUrl).toBe('https://aiseo.up.railway.app');
    expect(config.productionConfigurationStatus().providers.gsc).toBe(true);
  });
});
