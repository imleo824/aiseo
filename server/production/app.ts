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
import { EXPECTED_MIGRATION_VERSION, inspectDatabaseSecurity } from './databaseSecurity';
import { serializePublicRuntimeConfig } from './publicRuntimeConfig';

const securityHeaders = (_request: Request, response: Response, next: NextFunction): void => {
  const supabaseOrigin = (() => { try { return env.supabaseUrl ? new URL(env.supabaseUrl).origin : ''; } catch { return ''; } })();
  const supabaseWebSocketOrigin = supabaseOrigin.replace(/^http/, 'ws');
  const sentryOrigin = (() => { try { return env.browserSentryDsn ? new URL(env.browserSentryDsn).origin : ''; } catch { return ''; } })();
  const connectSources = ["'self'", supabaseOrigin, supabaseWebSocketOrigin, sentryOrigin, 'https://challenges.cloudflare.com'].filter(Boolean).join(' ');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src ${connectSources}`);
  next();
};

export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', Number.isInteger(configuredProxyHops) && configuredProxyHops > 0 ? configuredProxyHops : Boolean(process.env.RAILWAY_ENVIRONMENT));
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
  app.get('/api/health/ready', async (request, response) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};
    try {
      const status = await inspectDatabaseSecurity(prisma);
      const secure = status.role === 'app_backend' && !status.bypassRls && status.ownedBusinessTables === 0;
      checks.database = { ok: secure, detail: secure ? status.role : `role=${status.role}, bypassRls=${status.bypassRls}, ownedTables=${status.ownedBusinessTables}` };
      checks.migration = { ok: status.migrationVersion === EXPECTED_MIGRATION_VERSION, detail: status.migrationVersion };
    } catch (error) {
      checks.database = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      checks.migration = { ok: false, detail: 'database security inspection failed' };
    }
    try {
      const pong = await getQueueConnection().ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (error) {
      checks.redis = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    try {
      const heartbeat = await prisma.workerHeartbeat.findFirst({ orderBy: { heartbeatAt: 'desc' } });
      const age = heartbeat ? Date.now() - heartbeat.heartbeatAt.getTime() : Number.POSITIVE_INFINITY;
      checks.worker = { ok: age < 60_000, detail: heartbeat ? `${Math.floor(age / 1000)}s ago` : 'missing' };
    } catch (error) {
      checks.worker = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    const ready = Object.values(checks).every(({ ok }) => ok);
    response.status(ready ? 200 : 503).json({ data: { status: ready ? 'READY' : 'NOT_READY', checks, traceId: request.traceId } });
  });
  app.use('/api/v1', createRateLimiter(60_000, 300));
  app.use('/api/v1', apiRouter);
  app.use('/api/v1', (request, response) => response.status(404).json({ error: { code: 'API_NOT_FOUND', message: `Endpoint ${request.method} ${request.originalUrl} not found`, traceId: request.traceId } }));
  if (process.env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);
  app.use(errorHandler);
  return app;
};
