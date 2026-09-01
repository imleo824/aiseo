import { afterEach, describe, expect, it, vi } from 'vitest';

const savedEnvironment = { ...process.env };

afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in savedEnvironment)) delete process.env[name];
  Object.assign(process.env, savedEnvironment);
  vi.resetModules();
});

const setCommonProductionEnvironment = (encryptionKey = Buffer.alloc(32, 7).toString('base64')) => {
  process.env.NODE_ENV = 'production';
  process.env.REDIS_URL = 'rediss://redis.example.com:6380';
  process.env.APP_ENCRYPTION_KEY = encryptionKey;
  process.env.APP_BASE_URL = 'https://app.example.com';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  for (const name of ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'DATABASE_APP_URL', 'DATABASE_WORKER_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'TURNSTILE_SECRET_KEY', 'SMTP_PASSWORD']) delete process.env[name];
};

const setWebEnvironment = () => {
  setCommonProductionEnvironment();
  process.env.DATABASE_APP_URL = 'postgresql://app_backend:password@db.example.com:5432/postgres?sslmode=require&connection_limit=5&pool_timeout=10';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
};

const setWorkerEnvironment = () => {
  setCommonProductionEnvironment();
  process.env.DATABASE_WORKER_URL = 'postgresql://app_worker.projectref:password@pooler.example.com:5432/postgres?sslmode=require&connection_limit=5&pool_timeout=10';
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
  it('allows Web to receive only the app database role and publishable Auth key', async () => {
    setWebEnvironment();
    const config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).not.toThrow();
    expect(config.productionConfigurationStatus('web').runtime).toMatchObject({ service: 'web', database: true, databaseBackedApi: true });
  });

  it('allows Worker to receive only its database role and no Supabase credentials', async () => {
    setWorkerEnvironment();
    const config = await import('./env');
    expect(() => config.assertProductionConfiguration('worker')).not.toThrow();
    expect(config.productionConfigurationStatus('worker').runtime).toMatchObject({ service: 'worker', database: true, databaseBackedApi: true });
  });

  it('rejects Supabase keys in the Worker service', async () => {
    setWorkerEnvironment();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    let config = await import('./env');
    expect(() => config.assertProductionConfiguration('worker')).toThrow('must not be exposed');

    vi.resetModules();
    setWorkerEnvironment();
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('worker')).toThrow('must not be exposed');
  });

  it('rejects missing, cross-service, generic and administrator database credentials', async () => {
    setCommonProductionEnvironment();
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
    let config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('DATABASE_APP_URL');

    vi.resetModules();
    setWebEnvironment();
    process.env.DATABASE_WORKER_URL = 'postgresql://app_worker:password@db.example.com:5432/postgres?sslmode=require&connection_limit=5&pool_timeout=10';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('must not be exposed');

    vi.resetModules();
    setWebEnvironment();
    process.env.DATABASE_URL = 'postgresql://postgres:password@db.example.com:5432/postgres?sslmode=require';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('DATABASE_URL is not accepted');

    vi.resetModules();
    setWorkerEnvironment();
    process.env.DATABASE_ADMIN_URL = 'postgresql://postgres:password@db.example.com:5432/postgres?sslmode=require';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('worker')).toThrow('must never be exposed');
  });

  it('rejects the wrong database role, missing SSL and malformed envelope key', async () => {
    setWebEnvironment();
    process.env.DATABASE_APP_URL = 'postgresql://postgres:password@db.example.com:5432/postgres?sslmode=require&connection_limit=5&pool_timeout=10';
    let config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('authenticate as app_backend');

    vi.resetModules();
    setWebEnvironment();
    process.env.DATABASE_APP_URL = 'postgresql://app_backend:password@db.example.com:5432/postgres?connection_limit=5&pool_timeout=10';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('sslmode=require');

    vi.resetModules();
    setWebEnvironment();
    process.env.APP_ENCRYPTION_KEY = 'short-key';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('32-byte');
  });

  it('rejects transaction pooling and unbounded Prisma pools', async () => {
    setWebEnvironment();
    process.env.DATABASE_APP_URL = 'postgresql://app_backend:password@pooler.example.com:6543/postgres?sslmode=require&connection_limit=5&pool_timeout=10&pgbouncer=true';
    let config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('not transaction pooling');

    vi.resetModules();
    setWebEnvironment();
    process.env.DATABASE_APP_URL = 'postgresql://app_backend:password@db.example.com:5432/postgres?sslmode=require';
    config = await import('./env');
    expect(() => config.assertProductionConfiguration('web')).toThrow('connection_limit');
  });

  it('rejects malformed positive integer settings', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PAYMENT_INTENT_MINUTES = '0';
    await expect(import('./env')).rejects.toThrow('PAYMENT_INTENT_MINUTES must be a positive integer');
  });

  it('allows optional providers to fail closed without blocking Web boot', async () => {
    setWebEnvironment();
    const config = await import('./env');
    expect(config.productionConfigurationStatus('web').providers).toEqual({ gsc: false, dataForSeo: false, trc20Payments: false });
    expect(config.productionConfigurationWarnings('web')).toContain('GSC OAuth is not configured; GSC connection endpoints will fail closed.');
  });

  it('uses Railway public domain as APP_BASE_URL when not set explicitly', async () => {
    setWebEnvironment();
    setProviderEnvironment();
    delete process.env.APP_BASE_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = 'aiseo.up.railway.app';
    const config = await import('./env');
    expect(config.env.appBaseUrl).toBe('https://aiseo.up.railway.app');
    expect(config.productionConfigurationStatus('web').providers.gsc).toBe(true);
  });
});
