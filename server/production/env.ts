import { createHash } from 'crypto';

type Runtime = 'development' | 'test' | 'production';

const runtime = (process.env.NODE_ENV || 'development') as Runtime;
const raw = (name: string): string => process.env[name]?.trim() || '';

const asPositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

const inferredAppBaseUrl = (): string => {
  const explicit = raw('APP_BASE_URL');
  if (explicit) return explicit;
  const railwayDomain = raw('RAILWAY_PUBLIC_DOMAIN');
  if (railwayDomain) return `https://${railwayDomain}`;
  return 'http://localhost:3000';
};

const isValidTronBase58 = (value: string): boolean => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);

export const env = Object.freeze({
  runtime,
  databaseUrl: raw('DATABASE_APP_URL') || raw('DATABASE_URL'),
  workerDatabaseUrl: raw('DATABASE_WORKER_URL') || raw('DATABASE_URL'),
  redisUrl: raw('REDIS_URL'),
  supabaseUrl: raw('SUPABASE_URL'),
  supabasePublishableKey: raw('SUPABASE_PUBLISHABLE_KEY'),
  supabaseServiceRoleKey: raw('SUPABASE_SERVICE_ROLE_KEY'),
  turnstileSecretKey: raw('TURNSTILE_SECRET_KEY'),
  sentryDsn: raw('SENTRY_DSN'),
  appEncryptionKey: raw('APP_ENCRYPTION_KEY'),
  appBaseUrl: inferredAppBaseUrl(),
  gscClientId: process.env.GSC_CLIENT_ID || '',
  gscClientSecret: process.env.GSC_CLIENT_SECRET || '',
  dataForSeoLogin: process.env.DATAFORSEO_LOGIN || '',
  dataForSeoPassword: process.env.DATAFORSEO_PASSWORD || '',
  tronGridApiKey: process.env.TRONGRID_API_KEY || '',
  trc20RecipientAddress: process.env.TRC20_RECIPIENT_ADDRESS || '',
  trc20UsdtContract: process.env.TRC20_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
  paymentIntentMinutes: asPositiveInt('PAYMENT_INTENT_MINUTES', 30),
  gscStateSecret: process.env.GSC_STATE_SECRET || process.env.APP_ENCRYPTION_KEY || '',
  encryptionKeyFingerprint: createHash('sha256').update(process.env.APP_ENCRYPTION_KEY || '').digest('hex').slice(0, 12)
});

export const isValidEncryptionKey = (): boolean => Buffer.from(env.appEncryptionKey, 'base64').length === 32;
export const isDatabaseBackedRuntimeUnavailable = (): boolean => env.runtime === 'production' && (
  !raw('DATABASE_APP_URL') || !raw('DATABASE_WORKER_URL') || !env.redisUrl
  || !env.supabaseUrl || !env.supabasePublishableKey || !isValidEncryptionKey()
);

export const productionConfigurationStatus = () => ({
  appBaseUrl: env.appBaseUrl,
  runtime: {
    database: Boolean(env.databaseUrl),
    workerDatabase: Boolean(env.workerDatabaseUrl),
    redis: Boolean(env.redisUrl),
    encryptionKey: isValidEncryptionKey(),
    supabaseAuth: Boolean(env.supabaseUrl && env.supabasePublishableKey),
    turnstile: Boolean(env.turnstileSecretKey),
    sentry: Boolean(env.sentryDsn),
    databaseBackedApi: !isDatabaseBackedRuntimeUnavailable()
  },
  providers: {
    gsc: Boolean(env.gscClientId && env.gscClientSecret && env.gscStateSecret),
    dataForSeo: Boolean(env.dataForSeoLogin && env.dataForSeoPassword),
    trc20Payments: Boolean(env.tronGridApiKey && env.trc20RecipientAddress && isValidTronBase58(env.trc20RecipientAddress))
  }
});

export const productionConfigurationWarnings = (): string[] => {
  if (env.runtime !== 'production') return [];
  const warnings: string[] = [];
  if (!raw('DATABASE_APP_URL')) warnings.push('DATABASE_APP_URL is not set; the Web service cannot enforce the dedicated non-BYPASSRLS role.');
  if (!raw('DATABASE_WORKER_URL')) warnings.push('DATABASE_WORKER_URL is not set; the Worker cannot use its dedicated non-BYPASSRLS role.');
  if (!env.redisUrl) warnings.push('REDIS_URL is not set; asynchronous jobs are disabled.');
  if (!env.supabaseUrl || !env.supabasePublishableKey) warnings.push('Supabase Auth is not configured; authenticated API access is unavailable.');
  if (!env.turnstileSecretKey) warnings.push('TURNSTILE_SECRET_KEY is not set; public registration must remain closed.');
  if (!env.sentryDsn) warnings.push('SENTRY_DSN is not set; production error and performance monitoring is unavailable.');
  if (!env.appEncryptionKey) warnings.push('APP_ENCRYPTION_KEY is not set; credential encryption is disabled.');
  if (!raw('APP_BASE_URL') && !raw('RAILWAY_PUBLIC_DOMAIN')) warnings.push('APP_BASE_URL is not set; OAuth callbacks will default to localhost.');
  if (!env.gscClientId || !env.gscClientSecret) warnings.push('GSC OAuth is not configured; GSC connection endpoints will fail closed.');
  if (!env.dataForSeoLogin || !env.dataForSeoPassword) warnings.push('DataForSEO is not configured; SERP jobs will fail closed.');
  if (!env.tronGridApiKey || !env.trc20RecipientAddress) warnings.push('TRC20 payment verification is not configured; recharge endpoints will fail closed.');
  return warnings;
};

export const assertProductionConfiguration = (): void => {
  if (env.runtime !== 'production') return;
  if (env.appEncryptionKey && !isValidEncryptionKey()) {
    throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  if (env.trc20RecipientAddress && !isValidTronBase58(env.trc20RecipientAddress)) {
    throw new Error('TRC20_RECIPIENT_ADDRESS must be a valid base58 TRON address');
  }
  if (env.trc20UsdtContract && !isValidTronBase58(env.trc20UsdtContract)) {
    throw new Error('TRC20_USDT_CONTRACT must be a valid base58 TRON contract address');
  }
  if (!raw('DATABASE_APP_URL') || !raw('DATABASE_WORKER_URL')) {
    throw new Error('DATABASE_APP_URL and DATABASE_WORKER_URL are required in production');
  }
  if (!env.supabaseUrl || !env.supabasePublishableKey) {
    throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in production');
  }
  if (!env.supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in production');
  if (!env.turnstileSecretKey) throw new Error('TURNSTILE_SECRET_KEY is required in production');
  if (!env.sentryDsn) throw new Error('SENTRY_DSN is required in production');
};
