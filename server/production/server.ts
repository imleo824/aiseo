import express from 'express';
import path from 'path';
import { createApp } from './app';
import { assertProductionConfiguration, productionConfigurationWarnings } from './env';
import { closeQueue } from './queue';
import { disconnectDatabase } from './prisma';
import { logger } from '../utils/logger';

const start = async (): Promise<void> => {
  assertProductionConfiguration();
  productionConfigurationWarnings().forEach((warning) => logger.warn('CONFIGURATION', warning));
  const app = createApp();
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath, { index: false, fallthrough: true }));
  app.get('*', (_request, response) => response.sendFile(path.join(distPath, 'index.html')));

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => logger.info('SERVER_BOOT', `AISEO Web listening on http://${host}:${port}`));
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('SERVER_SHUTDOWN', `Received ${signal}`);
    server.close(() => {
      void Promise.all([closeQueue(), disconnectDatabase()]).finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
};

void start().catch((error) => {
  logger.error('SERVER_BOOT', 'Failed to start Web service', { data: error });
  process.exit(1);
});
