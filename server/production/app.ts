import express, { type NextFunction, type Request, type Response } from 'express';
import * as Sentry from '@sentry/node';
import { createRateLimiter } from '../middleware/rateLimiter';
import { traceMiddleware } from '../middleware/traceMiddleware';
import { logger } from '../utils/logger';
import { apiRouter } from './apiRouter';
import { env } from './env';
import { errorHandler } from './http';
import { getQueueConnection } from './queue';
import { prisma } from './prisma';
import { inspectDatabaseSecurity } from './databaseSecurity';
import { serializePublicRuntimeConfig } from './publicRuntimeConfig';

export const buildContentSecurityPolicy = (input: {
  runtime: 'development' | 'test' | 'production';
  supabaseUrl: string;
  sentryDsn: string;
}): string => {
  const supabaseOrigin = (() => { try { return input.supabaseUrl ? new URL(input.supabaseUrl).origin : ''; } catch { return ''; } })();
  const supabaseWebSocketOrigin = supabaseOrigin.replace(/^http/, 'ws');
  const sentryOrigin = (() => { try { return input.sentryDsn ? new URL(input.sentryDsn).origin : ''; } catch { return ''; } })();
  const connectSources = ["'self'", supabaseOrigin, supabaseWebSocketOrigin, sentryOrigin, 'https://challenges.cloudflare.com'].filter(Boolean).join(' ');
  // Vite's React Refresh preamble is an inline module in development/test.
  // Production assets remain protected by the stricter no-inline policy.
  const scriptSources = ["'self'", ...(input.runtime === 'production' ? [] : ["'unsafe-inline'"]), 'https://challenges.cloudflare.com'].join(' ');
  return `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSources}; frame-src https://challenges.cloudflare.com; connect-src ${connectSources}`;
};

const securityHeaders = (_request: Request, response: Response, next: NextFunction): void => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', buildContentSecurityPolicy({
    runtime: env.runtime,
    supabaseUrl: env.supabaseUrl,
    sentryDsn: env.browserSentryDsn
  }));
  next();
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  // Railway places one managed edge proxy in front of the container. Trusting
  // every hop would let a client-supplied X-Forwarded-For evade IP rate limits.
  app.set('trust proxy', Number.isInteger(configuredProxyHops) && configuredProxyHops > 0 ? configuredProxyHops : process.env.RAILWAY_ENVIRONMENT ? 1 : false);
  app.use(securityHeaders);
  app.use(traceMiddleware);
  app.use((request, response, next) => {
    const startedAt = Date.now();
    response.on('finish', () => {
      if (request.path.startsWith('/api/')) logger.info('HTTP_ACCESS', `${request.method} ${request.path} -> ${response.statusCode}`, { traceId: request.traceId, durationMs: Date.now() - startedAt });
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Browser-safe configuration is injected at container startup. This avoids
  // coupling Railway runtime variables to a particular Docker build artifact.
  app.get('/runtime-config.js', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.type('application/javascript').send(serializePublicRuntimeConfig({
      supabaseUrl: env.supabaseUrl,
      supabasePublishableKey: env.supabasePublishableKey,
      turnstileSiteKey: env.turnstileSiteKey,
      sentryDsn: env.browserSentryDsn,
      sentryTracesSampleRate: env.browserSentryTracesSampleRate,
      release: env.browserRelease
    }));
  });

  app.get('/api/health/live', (_request, response) => {
    response.json({ data: { status: 'UP', uptimeSeconds: Math.floor(process.uptime()), timestamp: new Date().toISOString() } });
  });
  app.use('/api/health/ready', createRateLimiter(60_000, 60, 'readiness'));
  app.get('/api/health/ready', async (request, response) => {
    const checks: Record<string, { ok: boolean }> = {};
    try {
      const status = await inspectDatabaseSecurity(prisma);
      const secure = status.role === 'app_backend' && !status.bypassRls && status.ownedBusinessTables === 0;
      checks.database = { ok: secure };
      checks.migration = { ok: status.requiredMigrationPresent };
    } catch (error) {
      checks.database = { ok: false };
      checks.migration = { ok: false };
      logger.warn('HEALTH_DATABASE', 'Database readiness check failed', { traceId: request.traceId, data: error });
    }
    try {
      const pong = await getQueueConnection().ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (error) {
      checks.redis = { ok: false };
      logger.warn('HEALTH_REDIS', 'Redis readiness check failed', { traceId: request.traceId, data: error });
    }
    try {
      const heartbeat = await prisma.workerHeartbeat.findFirst({ orderBy: { heartbeatAt: 'desc' } });
      const age = heartbeat ? Date.now() - heartbeat.heartbeatAt.getTime() : Number.POSITIVE_INFINITY;
      checks.worker = { ok: age < 60_000 };
    } catch (error) {
      checks.worker = { ok: false };
      logger.warn('HEALTH_WORKER', 'Worker readiness check failed', { traceId: request.traceId, data: error });
    }
    const ready = Object.values(checks).every(({ ok }) => ok);
    response.status(ready ? 200 : 503).json({ data: { status: ready ? 'READY' : 'NOT_READY', checks, traceId: request.traceId } });
  });
  app.use('/api/v1', createRateLimiter(60_000, 300));
  app.use('/api/v1', (_request, response, next) => {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    next();
  });
  app.use('/api/v1', apiRouter);
  app.use('/api/v1', (request, response) => response.status(404).json({ error: { code: 'API_NOT_FOUND', message: `Endpoint ${request.method} ${request.path} not found`, traceId: request.traceId } }));
  if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);
  return app;
};
