import { PrismaClient } from '@prisma/client';
import { env } from './env';

// This module is imported only by the Worker bundle. The Web bundle never
// constructs a client capable of using the Worker database role.
export const workerPrisma = new PrismaClient({
  datasources: { db: { url: env.workerDatabaseUrl } },
  log: ['error']
});

export const disconnectWorkerDatabase = () => workerPrisma.$disconnect();
