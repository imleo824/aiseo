import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  datasources: { db: { url: env.databaseUrl } },
  log: env.runtime === 'development' ? ['warn', 'error'] : ['error']
});

export type ScopedIdentity = { organizationId?: string; profileId: string };
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'>;

export const retrySerializableOperation = async <T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      // P2034 is PostgreSQL serialization/deadlock contention. P2002 can be
      // raised when two identical idempotent requests race to create the same
      // key; rerunning lets the loser read and replay the committed response.
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === 'P2034' || error.code === 'P2002');
      if (!retryable || attempt >= maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
};

export const withRequestScope = async <T>(identity: ScopedIdentity, operation: (tx: TransactionClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.profile_id', ${identity.profileId}, true)`;
    await tx.$executeRaw`select set_config('app.organization_id', ${identity.organizationId || ''}, true)`;
    return operation(tx as TransactionClient);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

export const withSerializableScope = async <T>(identity: ScopedIdentity, operation: (tx: TransactionClient) => Promise<T>): Promise<T> =>
  retrySerializableOperation(() => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.profile_id', ${identity.profileId}, true)`;
    await tx.$executeRaw`select set_config('app.organization_id', ${identity.organizationId || ''}, true)`;
    return operation(tx as TransactionClient);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

export const disconnectWebDatabase = () => prisma.$disconnect();
