import { createHash } from 'crypto';

type Runtime = 'development' | 'test' | 'production';

const runtime = (process.env.NODE_ENV || 'development') as Runtime;

const requiredInProduction = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value && runtime === 'production') {
    throw new Error(`Missing required production environment variable: ${name}`);
  }
  return value || '';
};

const asPositiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
};

export const env = Object.freeze({
  runtime,
  databaseUrl: requiredInProduction('DATABASE_URL') || process.env.DATABASE_URL || '',
  redisUrl: requiredInProduction('REDIS_URL') || process.env.REDIS_URL || '',
  appEncryptionKey: requiredInProduction('APP_ENCRYPTION_KEY') || process.env.APP_ENCRYPTION_KEY || '',
  appBaseUrl: requiredInProduction('APP_BASE_URL') || process.env.APP_BASE_URL || 'http://localhost:3000',
  gscClientId: process.env.GSC_CLIENT_ID || '',
  gscClientSecret: process.env.GSC_CLIENT_SECRET || '',
  dataForSeoLogin: process.env.DATAFORSEO_LOGIN || '',
  dataForSeoPassword: process.env.DATAFORSEO_PASSWORD || '',
  tronGridApiKey: process.env.TRONGRID_API_KEY || '',
  trc20RecipientAddress: process.env.TRC20_RECIPIENT_ADDRESS || '',
  trc20UsdtContract: process.env.TRC20_USDT_CONTRACT || 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
  paymentIntentMinutes: asPositiveInt('PAYMENT_INTENT_MINUTES', 30),
  dataForSeoCreditCost: asPositiveInt('DATAFORSEO_SERP_CREDIT_COST', 5),
  sessionHours: asPositiveInt('SESSION_HOURS', 24),
  gscStateSecret: process.env.GSC_STATE_SECRET || process.env.APP_ENCRYPTION_KEY || '',
  encryptionKeyFingerprint: createHash('sha256').update(process.env.APP_ENCRYPTION_KEY || '').digest('hex').slice(0, 12)
});

export const assertProductionConfiguration = (): void => {
  if (env.runtime !== 'production') return;
  const required = [
    ['GSC_CLIENT_ID', env.gscClientId],
    ['GSC_CLIENT_SECRET', env.gscClientSecret],
    ['DATAFORSEO_LOGIN', env.dataForSeoLogin],
    ['DATAFORSEO_PASSWORD', env.dataForSeoPassword],
    ['TRONGRID_API_KEY', env.tronGridApiKey],
    ['TRC20_RECIPIENT_ADDRESS', env.trc20RecipientAddress]
  ] as const;
  for (const [name, value] of required) {
    if (!value) throw new Error(`Missing required production environment variable: ${name}`);
  }
  if (Buffer.from(env.appEncryptionKey, 'base64').length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(env.trc20RecipientAddress)) {
    throw new Error('TRC20_RECIPIENT_ADDRESS must be a valid base58 TRON address');
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(env.trc20UsdtContract)) {
    throw new Error('TRC20_USDT_CONTRACT must be a valid base58 TRON contract address');
  }
};
