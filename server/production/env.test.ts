import { afterEach, describe, expect, it, vi } from 'vitest';

const savedEnvironment = { ...process.env };

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnvironment)) delete process.env[name];
  }
  Object.assign(process.env, savedEnvironment);
  vi.resetModules();
});

const setProductionEnvironment = (encryptionKey = Buffer.alloc(32, 7).toString('base64')) => {
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://postgres:password@db.example.com:5432/postgres?sslmode=require';
  process.env.REDIS_URL = 'rediss://redis.example.com:6380';
  process.env.APP_ENCRYPTION_KEY = encryptionKey;
  process.env.APP_BASE_URL = 'https://app.example.com';
  process.env.GSC_CLIENT_ID = 'client-id';
  process.env.GSC_CLIENT_SECRET = 'client-secret';
  process.env.DATAFORSEO_LOGIN = 'dataforseo-login';
  process.env.DATAFORSEO_PASSWORD = 'dataforseo-password';
  process.env.TRONGRID_API_KEY = 'trongrid-key';
  process.env.TRC20_RECIPIENT_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
};

describe('production configuration guard', () => {
  it('fails during boot when required database configuration is absent', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;
    await expect(import('./env')).rejects.toThrow('DATABASE_URL');
  });

  it('rejects malformed positive integer settings', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_HOURS = '0';
    await expect(import('./env')).rejects.toThrow('SESSION_HOURS must be a positive integer');
  });

  it('requires real production provider configuration and a 32-byte envelope key', async () => {
    setProductionEnvironment('short-key');
    const invalid = await import('./env');
    expect(() => invalid.assertProductionConfiguration()).toThrow('32-byte');

    vi.resetModules();
    setProductionEnvironment();
    const valid = await import('./env');
    expect(() => valid.assertProductionConfiguration()).not.toThrow();
    expect(valid.env.appBaseUrl).toBe('https://app.example.com');
    expect(valid.env.encryptionKeyFingerprint).toHaveLength(12);
  });
});
