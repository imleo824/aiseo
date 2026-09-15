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
const isCanonicalBase64Key = (value: string): boolean => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
};

const assertHttpsOrigin = (value: string, variable: string): void => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${variable} must be a valid URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${variable} must be a public HTTPS origin without credentials, port, path, query or fragment`);
  }
};

const assertSampleRate = (name: string): void => {
  const value = raw(name);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${name} must be a number from 0 to 1`);
};

export const assertEncryptionConfiguration = (): void => {
  const version = Number(raw('APP_ENCRYPTION_KEY_VERSION') || '1');
  if (!Number.isInteger(version) || version < 1 || version > 255) throw new Error('APP_ENCRYPTION_KEY_VERSION must be an integer from 1 to 255');
  if (!isCanonicalBase64Key(env.appEncryptionKey)) throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const serializedRing = raw('APP_ENCRYPTION_KEYS');
  if (!serializedRing) return;
  let ring: unknown;
  try { ring = JSON.parse(serializedRing); } catch { throw new Error('APP_ENCRYPTION_KEYS must be a JSON object of versioned base64 keys'); }
  if (!ring || typeof ring !== 'object' || Array.isArray(ring)) throw new Error('APP_ENCRYPTION_KEYS must be a JSON object of versioned base64 keys');
  const entries = Object.entries(ring as Record<string, unknown>);
  if (!entries.length) throw new Error('APP_ENCRYPTION_KEYS cannot be empty');
  for (const [keyVersion, encoded] of entries) {
    const numericVersion = Number(keyVersion);
    if (!/^\d+$/.test(keyVersion) || !Number.isInteger(numericVersion) || numericVersion < 1 || numericVersion > 255 || typeof encoded !== 'string' || !isCanonicalBase64Key(encoded)) {
      throw new Error(`APP_ENCRYPTION_KEYS version ${keyVersion} is invalid`);
    }
  }
  const currentKey = (ring as Record<string, unknown>)[String(version)];
  if (typeof currentKey !== 'string') throw new Error(`APP_ENCRYPTION_KEYS must include current version ${version}`);
  if (currentKey !== env.appEncryptionKey) throw new Error('APP_ENCRYPTION_KEY must equal the current key in APP_ENCRYPTION_KEYS');
};

export const env = Object.freeze({
  runtime,
  databaseUrl: raw('DATABASE_APP_URL'),
  workerDatabaseUrl: raw('DATABASE_WORKER_URL'),
  redisUrl: raw('REDIS_URL'),
  supabaseUrl: raw('SUPABASE_URL'),
  supabasePublishableKey: raw('SUPABASE_PUBLISHABLE_KEY'),
  supabaseServiceRoleKey: raw('SUPABASE_SERVICE_ROLE_KEY'),
  sentryDsn: raw('SENTRY_DSN'),
  browserSentryDsn: raw('VITE_SENTRY_DSN'),
  browserSentryTracesSampleRate: raw('VITE_SENTRY_TRACES_SAMPLE_RATE') || '0.1',
  browserRelease: raw('VITE_RELEASE') || raw('RAILWAY_GIT_COMMIT_SHA'),
  turnstileSiteKey: raw('VITE_TURNSTILE_SITE_KEY'),
  appEncryptionKey: raw('APP_ENCRYPTION_KEY'),
  appBaseUrl: inferredAppBaseUrl(),
  gscClientId: process.env.GSC_CLIENT_ID || '',
  gscClientSecret: process.env.GSC_CLIENT_SECRET || '',
  dataForSeoLogin: process.env.DATAFORSEO_LOGIN || '',
  dataForSeoPassword: process.env.DATAFORSEO_PASSWORD || '',
  defaultSeoLocationCode: asPositiveInt('DEFAULT_SEO_LOCATION_CODE', 2840),
  tronGridApiKey: process.env.TRONGRID_API_KEY || '',
  trc20RecipientAddress: process.env.TRC20_RECIPIENT_ADDRESS || '',
  trc20UsdtContract: process.env.TRC20_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
  paymentIntentMinutes: asPositiveInt('PAYMENT_INTENT_MINUTES', 30),
  gscStateSecret: process.env.GSC_STATE_SECRET || process.env.APP_ENCRYPTION_KEY || '',
  encryptionKeyFingerprint: createHash('sha256').update(process.env.APP_ENCRYPTION_KEY || '').digest('hex').slice(0, 12)
});

export const isValidEncryptionKey = (): boolean => isCanonicalBase64Key(env.appEncryptionKey);
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
  || !isValidEncryptionKey()
  || (service === 'web' && (!env.supabaseUrl || !env.supabasePublishableKey))
);

export const productionConfigurationStatus = (service: ServiceKind = 'web') => ({
  appBaseUrl: env.appBaseUrl,
  runtime: {
    service,
    database: Boolean(service === 'web' ? env.databaseUrl : env.workerDatabaseUrl),
    redis: Boolean(env.redisUrl),
    encryptionKey: isValidEncryptionKey(),
    supabaseAuth: service === 'web' ? Boolean(env.supabaseUrl && env.supabasePublishableKey) : true,
    turnstile: service === 'web' ? Boolean(env.turnstileSiteKey) : true,
    sentry: Boolean(env.sentryDsn),
    databaseBackedApi: !isDatabaseBackedRuntimeUnavailable(service)
  },
  providers: {
    gsc: Boolean(env.gscClientId && env.gscClientSecret && env.gscStateSecret),
    dataForSeo: Boolean(env.dataForSeoLogin && env.dataForSeoPassword),
    contentAi: Boolean(raw('OPENAI_API_KEY') || raw('GEMINI_API_KEY')),
    trc20Payments: Boolean(env.tronGridApiKey && env.trc20RecipientAddress && isValidTronBase58(env.trc20RecipientAddress))
  }
});

export const productionConfigurationWarnings = (service: ServiceKind): string[] => {
  if (env.runtime !== 'production') return [];
  const warnings: string[] = [];
  const databaseVariable = service === 'web' ? 'DATABASE_APP_URL' : 'DATABASE_WORKER_URL';
  if (!raw(databaseVariable)) warnings.push(`${databaseVariable} is not set; the ${service} service cannot use its dedicated non-BYPASSRLS role.`);
  if (!env.redisUrl) warnings.push('REDIS_URL is not set; asynchronous jobs are disabled.');
  if (service === 'web' && (!env.supabaseUrl || !env.supabasePublishableKey)) warnings.push('Required Supabase Auth credentials are not configured.');
  if (service === 'web' && !env.turnstileSiteKey) warnings.push('VITE_TURNSTILE_SITE_KEY is not set; protected signup cannot complete.');
  if (!env.sentryDsn) warnings.push('SENTRY_DSN is not set; production error and performance monitoring is unavailable.');
  if (!env.appEncryptionKey) warnings.push('APP_ENCRYPTION_KEY is not set; credential encryption is disabled.');
  if (service === 'web' && !raw('APP_BASE_URL') && !raw('RAILWAY_PUBLIC_DOMAIN')) warnings.push('APP_BASE_URL is not set; OAuth callbacks will default to localhost.');
  if (!env.gscClientId || !env.gscClientSecret) warnings.push(`GSC OAuth is not configured for ${service}; GSC operations will fail closed.`);
  if (service === 'worker' && (!env.dataForSeoLogin || !env.dataForSeoPassword)) warnings.push('DataForSEO is not configured; SERP jobs will fail closed.');
  if (service === 'worker' && !raw('OPENAI_API_KEY') && !raw('GEMINI_API_KEY')) warnings.push('OpenAI/Gemini is not configured; content jobs will fail closed.');
  if (service === 'worker' && (!env.tronGridApiKey || !env.trc20RecipientAddress)) warnings.push('TRC20 payment verification is not configured; recharge verification will fail closed.');
  return warnings;
};

export const assertProductionConfiguration = (service: ServiceKind): void => {
  if (env.runtime !== 'production') return;
  assertEncryptionConfiguration();
  assertHttpsOrigin(env.appBaseUrl, 'APP_BASE_URL');
  assertSampleRate('SENTRY_TRACES_SAMPLE_RATE');
  assertSampleRate('VITE_SENTRY_TRACES_SAMPLE_RATE');
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
    if (raw('DATAFORSEO_PASSWORD') || raw('OPENAI_API_KEY') || raw('GEMINI_API_KEY') || raw('TRONGRID_API_KEY')) {
      throw new Error('Worker-only provider secrets must not be exposed to the Web service');
    }
  } else {
    if (!env.workerDatabaseUrl) throw new Error('DATABASE_WORKER_URL is required for the Worker service');
    if (env.databaseUrl) throw new Error('DATABASE_APP_URL must not be exposed to the Worker service');
    expectedDatabaseRole(env.workerDatabaseUrl, 'app_worker', 'DATABASE_WORKER_URL');
    if (env.supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY must not be exposed to the Worker service; account erasure is isolated in Supabase Edge Functions');
    if (env.supabaseUrl || env.supabasePublishableKey || env.turnstileSiteKey || raw('VITE_SENTRY_DSN')) throw new Error('Browser and Supabase Auth configuration must not be exposed to the Worker service');
  }
  if (!env.redisUrl) throw new Error('REDIS_URL is required in production');
  if (service === 'web' && (!env.supabaseUrl || !env.supabasePublishableKey || !env.turnstileSiteKey)) throw new Error('Required Supabase Auth and Turnstile configuration is missing for web');
  if (service === 'web') assertHttpsOrigin(env.supabaseUrl, 'SUPABASE_URL');
  if (!env.sentryDsn) throw new Error('SENTRY_DSN is required in production');
  try {
    const sentry = new URL(env.sentryDsn);
    if (sentry.protocol !== 'https:') throw new Error();
  } catch {
    throw new Error('SENTRY_DSN must be a valid HTTPS DSN');
  }
};
