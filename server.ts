import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { traceMiddleware } from "./server/middleware/traceMiddleware";
import { createRateLimiter } from "./server/middleware/rateLimiter";
import { logger } from "./server/utils/logger";
import { apiV1Router, productionErrorHandler } from './server/production/router';
import { assertProductionConfiguration } from './server/production/env';
import { closeQueue } from './server/production/queue';
import { disconnectDatabase } from './server/production/prisma';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProduction = process.env.NODE_ENV === 'production';
  let legacyRepository: any;
  let legacyScheduler: any;

  if (isProduction) {
    assertProductionConfiguration();
  } else {
    const [{ fileTenantRepository }, { cronScheduler }] = await Promise.all([
      import('./server/infrastructure/persistence/fileTenantRepository'),
      import('./server/application/cronScheduler')
    ]);
    legacyRepository = fileTenantRepository;
    legacyScheduler = cronScheduler;
    legacyScheduler.start();
  }

  // Security Headers Middleware
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProduction) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
      );
    }
    next();
  });

  // Distributed Tracing Correlation Middleware
  app.use(traceMiddleware);

  // Request Logging Middleware with Trace ID
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api/')) {
        logger.info('HTTP_ACCESS', `${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`, {
          traceId: req.traceId,
          durationMs: duration
        });
      }
    });
    next();
  });

  // Body Parsing with large payload limit for rich HTML & knowledge sources
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Production APIs use database-backed sessions and explicit organization paths;
  // they must never pass through the legacy tenant-header middleware.
  app.use('/api/v1', createRateLimiter(60000, 120));
  app.use('/api/v1', apiV1Router);
  app.use('/api/v1', productionErrorHandler);

  // Health & Telemetry Check Endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "UP",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      mode: isProduction ? 'production' : 'development'
    });
  });

  if (!isProduction) {
    const [{ tenantMiddleware }, { apiRouter }] = await Promise.all([
      import('./server/middleware/tenant'),
      import('./server/routes')
    ]);
    app.use(tenantMiddleware);
    app.use('/api', createRateLimiter(60000, 300));
    app.use('/api', apiRouter);
  }

  // API 404 Fallback Handler
  app.use("/api/*", (req: Request, res: Response) => {
    res.status(404).json({
      error: {
        code: "API_NOT_FOUND",
        message: `Endpoint ${req.method} ${req.originalUrl} not found.`
      }
    });
  });

  // Global Error Handler Middleware
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const statusCode = err.statusCode || err.status || 500;
    const errorCode = err.errorCode || err.code || "INTERNAL_SERVER_ERROR";
    const message = err.message || "An unexpected error occurred on the server.";

    if (statusCode >= 500) {
      logger.error('SERVER_FATAL', `Unhandled Server Error: ${message}`, {
        traceId: req.traceId,
        data: {
          stack: err.stack,
          errorCode,
          statusCode
        }
      });
    } else {
      logger.warn('CLIENT_ERROR', `Request Error: [${statusCode}] ${errorCode} - ${message}`, {
        traceId: req.traceId,
        data: {
          path: req.path
        }
      });
    }

    res.status(statusCode).json({
      success: false,
      message,
      error: {
        code: errorCode,
        message,
        details: err.details,
        statusCode,
        traceId: req.traceId,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
      }
    });
  });

  // Serve static files in production or delegate to Vite in dev
  if (isProduction) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.info('SERVER_BOOT', `[SEO Cruise Engine] Enterprise Server running on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info('SERVER_SHUTDOWN', `Received ${signal}. Shutting down gracefully...`);
    legacyScheduler?.stop();
    server.close(() => {
      Promise.all([
        legacyRepository?.forceFlush?.(),
        closeQueue(),
        disconnectDatabase()
      ])
        .catch((error) => logger.error('SERVER_SHUTDOWN', `Final data flush failed: ${error?.message}`))
        .finally(() => {
          logger.info('SERVER_SHUTDOWN', `Closed all active connections.`);
          process.exit(0);
        });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
