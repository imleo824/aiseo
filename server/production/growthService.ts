import { GrowthCycleStatus, GrowthCycleTrigger, GrowthStateStatus, JobType } from '@prisma/client';
import type { TransactionClient } from './prisma';
import { jobService } from './jobService';

export const growthService = {
  async createCycle(tx: TransactionClient, input: {
    organizationId: string;
    siteId: string;
    trigger: GrowthCycleTrigger;
    idempotencyKey: string;
    inputWatermark?: Date;
  }) {
    const state = await tx.siteGrowthState.findUnique({ where: { siteId: input.siteId } });
    if (!state || state.organizationId !== input.organizationId) throw new Error('站点增长状态尚未初始化');
    if (state.status === GrowthStateStatus.PAUSED) throw new Error('站点增长已暂停');
    const active = await tx.growthCycle.findFirst({
      where: { organizationId: input.organizationId, siteId: input.siteId, status: { in: [GrowthCycleStatus.QUEUED, GrowthCycleStatus.RUNNING] } },
      orderBy: { createdAt: 'desc' }
    });
    if (active) return { cycle: active, job: active.jobRunId ? await tx.jobRun.findUnique({ where: { id: active.jobRunId } }) : null, replayed: true };

    const cycle = await tx.growthCycle.create({
      data: {
        organizationId: input.organizationId,
        siteId: input.siteId,
        trigger: input.trigger,
        stateVersion: state.stateVersion,
        inputWatermark: input.inputWatermark
      }
    });
    const job = await jobService.create(tx, {
      organizationId: input.organizationId,
      type: JobType.GROWTH_CYCLE,
      idempotencyKey: input.idempotencyKey,
      payload: { cycleId: cycle.id, siteId: input.siteId }
    });
    const linked = await tx.growthCycle.update({ where: { id: cycle.id }, data: { jobRunId: job.id } });
    return { cycle: linked, job, replayed: false };
  },

  async pause(tx: TransactionClient, organizationId: string, siteId: string) {
    const now = new Date();
    const state = await tx.siteGrowthState.findFirst({ where: { organizationId, siteId } });
    if (!state) throw new Error('站点尚未开始增长');
    await Promise.all([
      tx.siteGrowthState.update({ where: { id: state.id }, data: { status: GrowthStateStatus.PAUSED, pausedAt: now, nextDecisionAt: null } }),
      tx.growthCycle.updateMany({ where: { organizationId, siteId, status: GrowthCycleStatus.QUEUED }, data: { status: GrowthCycleStatus.CANCELLED, finishedAt: now } }),
      tx.jobRun.updateMany({ where: { organizationId, type: JobType.GROWTH_CYCLE, status: 'QUEUED', payload: { path: ['siteId'], equals: siteId } }, data: { status: 'CANCELLED', finishedAt: now } })
    ]);
    return tx.siteGrowthState.findUniqueOrThrow({ where: { id: state.id } });
  }
};
