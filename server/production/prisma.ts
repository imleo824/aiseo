import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  datasources: env.databaseUrl ? { db: { url: env.databaseUrl } } : undefined,
  log: env.runtime === 'development' ? ['warn', 'error'] : ['error']
});

export const workerPrisma = new PrismaClient({
  datasources: env.workerDatabaseUrl ? { db: { url: env.workerDatabaseUrl } } : undefined,
  log: ['error']
});

export type ScopedIdentity = { organizationId?: string; profileId: string };
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'>;

export const withRequestScope = async <T>(identity: ScopedIdentity, operation: (tx: TransactionClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.profile_id', ${identity.profileId}, true)`;
    await tx.$executeRaw`select set_config('app.organization_id', ${identity.organizationId || ''}, true)`;
    return operation(tx as TransactionClient);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

export const withSerializableScope = async <T>(identity: ScopedIdentity, operation: (tx: TransactionClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.profile_id', ${identity.profileId}, true)`;
    await tx.$executeRaw`select set_config('app.organization_id', ${identity.organizationId || ''}, true)`;
    return operation(tx as TransactionClient);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const disconnectDatabase = () => Promise.all([prisma.$disconnect(), workerPrisma.$disconnect()]).then(() => undefined);
