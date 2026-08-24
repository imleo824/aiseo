import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { tenantMiddleware } from "./server/middleware/tenant";
import { traceMiddleware } from "./server/middleware/traceMiddleware";
import { createRateLimiter } from "./server/middleware/rateLimiter";
import { apiRouter } from "./server/routes";
import { fileTenantRepository } from "./server/infrastructure/persistence/fileTenantRepository";
import { geminiCircuitBreaker, indexingCircuitBreaker } from "./server/infrastructure/resilience/circuitBreaker";
import { serpAnalysisCache } from "./server/utils/lruCache";
import { cronScheduler } from "./server/application/cronScheduler";
import { webhookNotifier } from "./server/application/webhookNotifier";
import { logger } from "./server/utils/logger";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Start background cron scheduler & webhook event listener
  cronScheduler.start();
  webhookNotifier.init();

  // Security Headers Middleware
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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

  // Attach Tenant Isolation Middleware
  app.use(tenantMiddleware);

  // Rate Limiter for API endpoints
  app.use('/api', createRateLimiter(60000, 300));

  // Health & Telemetry Check Endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    const tenantIds = fileTenantRepository.getAllTenantIds();
    res.json({
      status: "UP",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      environment: process.env.NODE_ENV || "development",
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
      storeStats: {
        totalTenants: tenantIds.length,
        tenants: tenantIds
      },
      telemetry: {
        geminiCircuit: geminiCircuitBreaker.getMetrics(),
        indexingCircuit: indexingCircuitBreaker.getMetrics(),
        serpCacheSize: serpAnalysisCache.size()
      }
    });
  });

  // Mount Primary API Router
  app.use("/api", apiRouter);

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
    logger.error('SERVER_FATAL', `Unhandled Express Error: ${err?.message || err}`, {
      traceId: req.traceId,
      data: err?.stack
    });
    res.status(err.status || 500).json({
      error: {
        code: err.code || "INTERNAL_SERVER_ERROR",
        message: err.message || "An unexpected error occurred on the server.",
        ...(process.env.NODE_ENV !== "production" ? { stack: err.stack } : {})
      }
    });
  });

  // Serve static files in production or delegate to Vite in dev
  if (process.env.NODE_ENV === "production") {
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
  const shutdown = (signal: string) => {
    logger.info('SERVER_SHUTDOWN', `Received ${signal}. Shutting down gracefully...`);
    cronScheduler.stop();
    server.close(() => {
      logger.info('SERVER_SHUTDOWN', `Closed all active connections.`);
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();
