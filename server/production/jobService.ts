import { JobStatus, JobType, Prisma } from '@prisma/client';
import { NotFoundError } from '../domain/errors';
import { billingService } from './billingService';
import type { TransactionClient } from './prisma';

type CreateJobInput = {
  organizationId: string;
  type: JobType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  priceAction?: string;
  availableAt?: Date;
};

export const jobService = {
  async create(tx: TransactionClient, input: CreateJobInput) {
    const existing = await tx.jobRun.findFirst({
      where: { organizationId: input.organizationId, type: input.type, idempotencyKey: input.idempotencyKey }
    });
    if (existing) return { id: existing.id, status: existing.status, replayed: true };
    const run = await tx.jobRun.create({
      data: {
        organizationId: input.organizationId,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload as Prisma.InputJsonValue,
        availableAt: input.availableAt
      }
    });
    if (input.priceAction) {
      const price = await tx.actionPrice.findFirst({ where: { action: input.priceAction, active: true } });
      if (!price) throw new NotFoundError(`计价项 ${input.priceAction} 不存在或已停用`);
      await billingService.reserveCredits(tx, input.organizationId, run.id, price.creditMicros, input.priceAction);
    }
    return { id: run.id, status: JobStatus.QUEUED, replayed: false };
  },

  async get(tx: TransactionClient, organizationId: string, jobRunId: string) {
    const job = await tx.jobRun.findFirst({ where: { id: jobRunId, organizationId } });
    if (!job) throw new NotFoundError('异步任务不存在');
    return job;
  }
};
