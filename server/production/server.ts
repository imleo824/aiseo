import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { apiV1Router, productionErrorHandler } from './router';
import { assertProductionConfiguration } from './env';
import { closeQueue } from './queue';
import { disconnectDatabase } from './prisma';
import { createRateLimiter } from '../middleware/rateLimiter';
import { traceMiddleware } from '../middleware/traceMiddleware';
import { logger } from '../utils/logger';

const addSecurityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
  next();
};

const startProductionServer = (): void => {
  assertProductionConfiguration();
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const distPath = path.join(process.cwd(), 'dist');
  app.disable('x-powered-by');
  app.set('trust proxy', false);
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
  app.use('/api/v1', createRateLimiter(60_000, 120));
  app.use('/api/v1', apiV1Router);
  app.use('/api/v1', productionErrorHandler);
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'UP', timestamp: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()), mode: 'production' });
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

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info('SERVER_BOOT', `Production API running on http://0.0.0.0:${port}`);
  });
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('SERVER_SHUTDOWN', `Received ${signal}. Shutting down gracefully.`);
    server.close(() => {
      Promise.all([closeQueue(), disconnectDatabase()])
        .catch((error) => logger.error('SERVER_SHUTDOWN', 'Failed to close production resources', { data: error }))
        .finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

startProductionServer();
