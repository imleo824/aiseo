import { JobStatus, JobType, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../domain/errors';
import { billingService } from './billingService';
import { env } from './env';
import { prisma } from './prisma';
import { getProductionQueue, productionJobOptions } from './queue';

type EnqueueInput = { organizationId: string; type: JobType; payload: Record<string, unknown>; idempotencyKey: string; reserveCredits?: number };

export const jobService = {
  async enqueue(input: EnqueueInput): Promise<{ id: string; status: JobStatus; replayed: boolean }> {
    const existing = await prisma.jobRun.findFirst({ where: { organizationId: input.organizationId, type: input.type, idempotencyKey: input.idempotencyKey } });
    if (existing) return { id: existing.id, status: existing.status, replayed: true };
    let run;
    try {
      run = await prisma.jobRun.create({ data: { organizationId: input.organizationId, type: input.type, idempotencyKey: input.idempotencyKey, payload: input.payload as Prisma.InputJsonValue } });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const replay = await prisma.jobRun.findFirstOrThrow({ where: { organizationId: input.organizationId, type: input.type, idempotencyKey: input.idempotencyKey } });
        return { id: replay.id, status: replay.status, replayed: true };
      }
      throw error;
    }
    try {
      if (input.reserveCredits) await billingService.reserveCredits(input.organizationId, run.id, input.reserveCredits, `${input.type} 数据任务`);
      const queueJob = await getProductionQueue().add(input.type, { jobRunId: run.id }, productionJobOptions(run.id));
      await prisma.jobRun.update({ where: { id: run.id }, data: { queueJobId: String(queueJob.id) } });
      return { id: run.id, status: JobStatus.QUEUED, replayed: false };
    } catch (error) {
      await billingService.releaseCreditHold(run.id);
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: JobStatus.FAILED, errorCode: 'QUEUE_ENQUEUE_FAILED', errorMessage: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
      throw error;
    }
  },

  async get(organizationId: string, jobRunId: string) {
    const job = await prisma.jobRun.findFirst({ where: { id: jobRunId, organizationId } });
    if (!job) throw new NotFoundError('异步作业不存在');
    return job;
  },

  async queueDataForSeoPoll(jobRunId: string, providerTaskId: string, pollCount: number): Promise<void> {
    if (pollCount >= 20) throw new ConflictError('DataForSEO 任务超过最大等待次数');
    await getProductionQueue().add(JobType.DATAFORSEO_SERP, { jobRunId, providerTaskId, pollCount }, productionJobOptions(`${jobRunId}:poll:${pollCount}`, { delay: 15_000 }));
  },

  async removeExpiredIdempotencyKeys(): Promise<void> {
    await prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  },

  dataForSeoCreditCost: () => env.dataForSeoCreditCost
};
