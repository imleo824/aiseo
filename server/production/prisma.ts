import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  log: env.runtime === 'development' ? ['warn', 'error'] : ['error']
});

export type ScopedIdentity = { organizationId: string; userId: string };
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

export const withOrganizationScope = async <T>(identity: ScopedIdentity, operation: (tx: TransactionClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.organization_id', ${identity.organizationId}, true)`;
    await tx.$executeRaw`select set_config('app.user_id', ${identity.userId}, true)`;
    return operation(tx as TransactionClient);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const disconnectDatabase = () => prisma.$disconnect();
