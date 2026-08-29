import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
  log: env.runtime === 'development' ? ['warn', 'error'] : ['error']
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

export const disconnectWebDatabase = () => prisma.$disconnect();
