import { createHash } from 'crypto';

type Runtime = 'development' | 'test' | 'production';
export type ServiceKind = 'web' | 'worker';

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
  databaseUrl: raw('DATABASE_APP_URL'),
  workerDatabaseUrl: raw('DATABASE_WORKER_URL'),
  redisUrl: raw('REDIS_URL'),
  supabaseUrl: raw('SUPABASE_URL'),
  supabasePublishableKey: raw('SUPABASE_PUBLISHABLE_KEY'),
  supabaseServiceRoleKey: raw('SUPABASE_SERVICE_ROLE_KEY'),
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
const expectedDatabaseRole = (url: string, role: 'app_backend' | 'app_worker', variable: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${variable} must be a valid PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error(`${variable} must use the postgresql protocol`);
  const username = decodeURIComponent(parsed.username);
  // Shared Supavisor uses role.project_ref; direct and dedicated connections
  // use the role name without the project suffix.
  if (username !== role && !username.startsWith(`${role}.`)) throw new Error(`${variable} must authenticate as ${role}`);
  if (!parsed.password) throw new Error(`${variable} must include the dedicated role password`);
  if (parsed.searchParams.get('sslmode') !== 'require') throw new Error(`${variable} must set sslmode=require`);
  if (parsed.port === '6543' || parsed.searchParams.get('pgbouncer') === 'true') {
    throw new Error(`${variable} must use a direct or Supavisor Session connection, not transaction pooling`);
  }
  const connectionLimit = Number(parsed.searchParams.get('connection_limit'));
  const poolTimeout = Number(parsed.searchParams.get('pool_timeout'));
  if (!Number.isInteger(connectionLimit) || connectionLimit < 1 || connectionLimit > 20) throw new Error(`${variable} must set connection_limit between 1 and 20`);
  if (!Number.isInteger(poolTimeout) || poolTimeout < 1 || poolTimeout > 30) throw new Error(`${variable} must set pool_timeout between 1 and 30 seconds`);
};

export const isDatabaseBackedRuntimeUnavailable = (service: ServiceKind): boolean => env.runtime === 'production' && (
  !(service === 'web' ? env.databaseUrl : env.workerDatabaseUrl) || !env.redisUrl
  || !env.supabaseUrl || !isValidEncryptionKey()
  || (service === 'web' ? !env.supabasePublishableKey : !env.supabaseServiceRoleKey)
);

export const productionConfigurationStatus = (service: ServiceKind = 'web') => ({
  appBaseUrl: env.appBaseUrl,
  runtime: {
    service,
    database: Boolean(service === 'web' ? env.databaseUrl : env.workerDatabaseUrl),
    redis: Boolean(env.redisUrl),
    encryptionKey: isValidEncryptionKey(),
    supabaseAuth: Boolean(env.supabaseUrl && (service === 'web' ? env.supabasePublishableKey : env.supabaseServiceRoleKey)),
    sentry: Boolean(env.sentryDsn),
    databaseBackedApi: !isDatabaseBackedRuntimeUnavailable(service)
  },
  providers: {
    gsc: Boolean(env.gscClientId && env.gscClientSecret && env.gscStateSecret),
    dataForSeo: Boolean(env.dataForSeoLogin && env.dataForSeoPassword),
    trc20Payments: Boolean(env.tronGridApiKey && env.trc20RecipientAddress && isValidTronBase58(env.trc20RecipientAddress))
  }
});

export const productionConfigurationWarnings = (service: ServiceKind): string[] => {
  if (env.runtime !== 'production') return [];
  const warnings: string[] = [];
  const databaseVariable = service === 'web' ? 'DATABASE_APP_URL' : 'DATABASE_WORKER_URL';
  if (!raw(databaseVariable)) warnings.push(`${databaseVariable} is not set; the ${service} service cannot use its dedicated non-BYPASSRLS role.`);
  if (!env.redisUrl) warnings.push('REDIS_URL is not set; asynchronous jobs are disabled.');
  if (!env.supabaseUrl || (service === 'web' ? !env.supabasePublishableKey : !env.supabaseServiceRoleKey)) warnings.push('Required Supabase Auth credentials are not configured.');
  if (!env.sentryDsn) warnings.push('SENTRY_DSN is not set; production error and performance monitoring is unavailable.');
  if (!env.appEncryptionKey) warnings.push('APP_ENCRYPTION_KEY is not set; credential encryption is disabled.');
  if (service === 'web' && !raw('APP_BASE_URL') && !raw('RAILWAY_PUBLIC_DOMAIN')) warnings.push('APP_BASE_URL is not set; OAuth callbacks will default to localhost.');
  if (!env.gscClientId || !env.gscClientSecret) warnings.push('GSC OAuth is not configured; GSC connection endpoints will fail closed.');
  if (!env.dataForSeoLogin || !env.dataForSeoPassword) warnings.push('DataForSEO is not configured; SERP jobs will fail closed.');
  if (!env.tronGridApiKey || !env.trc20RecipientAddress) warnings.push('TRC20 payment verification is not configured; recharge endpoints will fail closed.');
  return warnings;
};

export const assertProductionConfiguration = (service: ServiceKind): void => {
  if (env.runtime !== 'production') return;
  if (!env.appEncryptionKey || !isValidEncryptionKey()) throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  if (env.trc20RecipientAddress && !isValidTronBase58(env.trc20RecipientAddress)) {
    throw new Error('TRC20_RECIPIENT_ADDRESS must be a valid base58 TRON address');
  }
  if (env.trc20UsdtContract && !isValidTronBase58(env.trc20UsdtContract)) {
    throw new Error('TRC20_USDT_CONTRACT must be a valid base58 TRON contract address');
  }
  if (raw('DATABASE_URL')) throw new Error('DATABASE_URL is not accepted at runtime; use the service-scoped database variable');
  if (raw('DATABASE_ADMIN_URL')) throw new Error('DATABASE_ADMIN_URL must never be exposed to a Web or Worker service');
  if (raw('TURNSTILE_SECRET_KEY') || raw('SMTP_PASSWORD')) throw new Error('Supabase-managed Turnstile and SMTP secrets must not be exposed to application services');
  if (service === 'web') {
    if (!env.databaseUrl) throw new Error('DATABASE_APP_URL is required for the Web service');
    if (env.workerDatabaseUrl) throw new Error('DATABASE_WORKER_URL must not be exposed to the Web service');
    expectedDatabaseRole(env.databaseUrl, 'app_backend', 'DATABASE_APP_URL');
    if (env.supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY must not be exposed to the Web service');
  } else {
    if (!env.workerDatabaseUrl) throw new Error('DATABASE_WORKER_URL is required for the Worker service');
    if (env.databaseUrl) throw new Error('DATABASE_APP_URL must not be exposed to the Worker service');
    expectedDatabaseRole(env.workerDatabaseUrl, 'app_worker', 'DATABASE_WORKER_URL');
  }
  if (!env.redisUrl) throw new Error('REDIS_URL is required in production');
  if (!env.supabaseUrl || (service === 'web' ? !env.supabasePublishableKey : !env.supabaseServiceRoleKey)) throw new Error(`Required Supabase Auth configuration is missing for ${service}`);
  if (!env.sentryDsn) throw new Error('SENTRY_DSN is required in production');
};
