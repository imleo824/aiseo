import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { assertProductionConfiguration, isDatabaseBackedRuntimeUnavailable, productionConfigurationStatus, productionConfigurationWarnings } from './env';
import { closeQueue } from './queue';
import { disconnectDatabase } from './prisma';
import { createRateLimiter } from '../middleware/rateLimiter';
import { traceMiddleware } from '../middleware/traceMiddleware';
import { logger } from '../utils/logger';
import { requireSameOriginForCookieWrites } from '../middleware/csrf';
import { AUTOMATION_PIPELINE_STAGE_COUNT } from '../../src/types/seo';

const addSecurityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  next();
};

const startProductionServer = async (): Promise<void> => {
  assertProductionConfiguration();
  for (const warning of productionConfigurationWarnings()) {
    logger.warn('CONFIGURATION', warning);
  }
  const app = express();
  let scheduler: { start: () => void; stop: () => void } | undefined;
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const distPath = path.join(process.cwd(), 'dist');
  app.disable('x-powered-by');
  const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS);
  app.set('trust proxy', Number.isInteger(configuredProxyHops) && configuredProxyHops > 0 ? configuredProxyHops : Boolean(process.env.RAILWAY_ENVIRONMENT));
  app.use(addSecurityHeaders);
  app.use(traceMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) {
        logger.info('HTTP_ACCESS', `${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - startedAt}ms)`, { traceId: req.traceId });
      }
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(requireSameOriginForCookieWrites);
  const [{ tenantMiddleware }, { apiRouter }, { cronScheduler }] = await Promise.all([
    import('../middleware/tenant'),
    import('../routes'),
    import('../application/cronScheduler')
  ]);
  scheduler = cronScheduler;
  scheduler.start();
  app.use(tenantMiddleware);
  app.use('/api', createRateLimiter(60_000, 300));
  app.use('/api', apiRouter);
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: isDatabaseBackedRuntimeUnavailable() ? 'DEGRADED' : 'UP',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      mode: 'production',
      apiPath: '/api',
      automationStages: AUTOMATION_PIPELINE_STAGE_COUNT,
      buildRevision: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT || process.env.GIT_COMMIT_SHA || 'unavailable',
      configuration: productionConfigurationStatus()
    });
  });
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'API_NOT_FOUND', message: `Endpoint ${req.method} ${req.originalUrl} not found.` } });
  });
  app.use(express.static(distPath, { index: false, fallthrough: true }));
  app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(distPath, 'index.html')));
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error('SERVER_FATAL', 'Unhandled production server error', { traceId: req.traceId, data: error });
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: '服务器内部错误', traceId: req.traceId } });
  });

  const server = app.listen(port, host, () => {
    logger.info('SERVER_BOOT', `Production API running on http://${host}:${port}`);
  });
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('SERVER_SHUTDOWN', `Received ${signal}. Shutting down gracefully.`);
    server.close(() => {
      scheduler?.stop();
      Promise.all([closeQueue(), disconnectDatabase()])
        .catch((error) => logger.error('SERVER_SHUTDOWN', 'Failed to close production resources', { data: error }))
        .finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

startProductionServer().catch((error) => {
  logger.error('SERVER_BOOT', 'Failed to start production server', { data: error });
  process.exit(1);
});
