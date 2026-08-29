import { createServer as createViteServer } from 'vite';
import { createApp } from './server/production/app';
import { closeQueue } from './server/production/queue';
import { disconnectWebDatabase } from './server/production/prisma';
import { logger } from './server/utils/logger';

const start = async (): Promise<void> => {
  const app = createApp();
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => logger.info('SERVER_BOOT', `AISEO development Web listening on http://0.0.0.0:${port}`));
  const shutdown = (): void => {
    server.close(() => void Promise.all([vite.close(), closeQueue(), disconnectWebDatabase()]).finally(() => process.exit(0)));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
};

void start().catch((error) => {
  logger.error('SERVER_BOOT', 'Failed to start development Web service', { data: error });
  process.exit(1);
});
