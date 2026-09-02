import { createHash } from 'crypto';
import {
  GrowthInputType,
  GrowthProgramMode,
  GrowthRunStageCode,
  GrowthRunTrigger,
  JobType
} from '@prisma/client';
import type { TransactionClient } from './prisma';
import { jobService } from './jobService';

export const GROWTH_STAGES = [
  GrowthRunStageCode.UNDERSTAND,
  GrowthRunStageCode.DISCOVER,
  GrowthRunStageCode.DECIDE,
  GrowthRunStageCode.EXECUTE,
  GrowthRunStageCode.LEARN
] as const;

const fingerprint = (parts: string[]): string => createHash('sha256').update(parts.join('\n')).digest('hex');

export const growthProgramService = {
  async create(tx: TransactionClient, input: {
    organizationId: string;
    siteId: string;
    mode: GrowthProgramMode;
    inputType: GrowthInputType;
    inputValue: string;
    occurrenceKey: string;
    budgetLimitMicros?: bigint;
  }) {
    const inputValue = input.inputValue.trim();
    const inputFingerprint = fingerprint([
      input.organizationId,
      input.siteId,
      input.mode,
      input.inputType,
      inputValue,
      input.mode === GrowthProgramMode.ONCE ? input.occurrenceKey : 'continuous'
    ]);
    const existing = await tx.growthProgram.findUnique({
      where: { organizationId_inputFingerprint: { organizationId: input.organizationId, inputFingerprint } },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1, include: { stages: { orderBy: { createdAt: 'asc' } } } } }
    });
    if (existing) {
      const run = existing.runs[0] || null;
      return { program: existing, run, job: run?.jobRunId ? await tx.jobRun.findUnique({ where: { id: run.jobRunId } }) : null, replayed: true };
    }

    const now = new Date();
    const program = await tx.growthProgram.create({ data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      mode: input.mode,
      inputType: input.inputType,
      inputValue,
      inputFingerprint,
      budgetLimitMicros: input.budgetLimitMicros,
      nextRunAt: input.mode === GrowthProgramMode.CONTINUOUS ? new Date(now.getTime() + 7 * 86_400_000) : null
    } });
    const run = await tx.growthRun.create({ data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      programId: program.id,
      trigger: GrowthRunTrigger.USER,
      occurrenceKey: input.occurrenceKey,
      stages: { create: GROWTH_STAGES.map((stage) => ({ organizationId: input.organizationId, siteId: input.siteId, stage })) }
    }, include: { stages: { orderBy: { createdAt: 'asc' } } } });
    const job = await jobService.create(tx, {
      organizationId: input.organizationId,
      type: JobType.GROWTH_RUN,
      idempotencyKey: `growth-run:${run.id}`,
      payload: { growthRunId: run.id },
      priceAction: 'GROWTH_RUN'
    });
    const linked = await tx.growthRun.update({ where: { id: run.id }, data: { jobRunId: job.id }, include: { stages: { orderBy: { createdAt: 'asc' } } } });
    await tx.auditEvent.create({ data: {
      organizationId: input.organizationId,
      action: 'GROWTH_PROGRAM_CREATED',
      targetType: 'growth_program',
      targetId: program.id,
      metadata: { mode: input.mode, inputType: input.inputType, runId: run.id }
    } });
    return { program, run: linked, job, replayed: false };
  },

  async createScheduledRun(tx: TransactionClient, input: {
    organizationId: string;
    programId: string;
    siteId: string;
    occurrenceKey: string;
  }) {
    const existing = await tx.growthRun.findUnique({ where: { programId_occurrenceKey: { programId: input.programId, occurrenceKey: input.occurrenceKey } } });
    if (existing) return existing;
    const run = await tx.growthRun.create({ data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      programId: input.programId,
      trigger: GrowthRunTrigger.SCHEDULED,
      occurrenceKey: input.occurrenceKey,
      stages: { create: GROWTH_STAGES.map((stage) => ({ organizationId: input.organizationId, siteId: input.siteId, stage })) }
    } });
    const job = await jobService.create(tx, {
      organizationId: input.organizationId,
      type: JobType.GROWTH_RUN,
      idempotencyKey: `growth-run:${run.id}`,
      payload: { growthRunId: run.id },
      priceAction: 'GROWTH_RUN'
    });
    return tx.growthRun.update({ where: { id: run.id }, data: { jobRunId: job.id } });
  }
};
