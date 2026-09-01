import { createHash } from 'crypto';
import { ExecutionMode, ExecutionSourceType, JobType } from '@prisma/client';
import type { TransactionClient } from './prisma';
import { jobService } from './jobService';

export type ExecutionSourceInput = {
  sourceType: ExecutionSourceType;
  sourceValue: string;
  languageCode: string;
  locationCode: number;
};

const fingerprint = (parts: string[]): string => createHash('sha256').update(parts.join('\n')).digest('hex');

export const executionService = {
  async create(tx: TransactionClient, input: {
    organizationId: string;
    siteId: string;
    mode: ExecutionMode;
    source: ExecutionSourceInput;
    occurrenceKey: string;
    automationTaskId?: string;
  }) {
    const sourceValue = input.source.sourceValue.trim();
    const sourceFingerprint = fingerprint([input.organizationId, input.siteId, input.mode, input.source.sourceType, sourceValue || '', input.occurrenceKey]);
    const existing = await tx.executionRun.findUnique({ where: { organizationId_sourceFingerprint: { organizationId: input.organizationId, sourceFingerprint } } });
    if (existing) {
      return { execution: existing, job: existing.jobRunId ? await tx.jobRun.findUnique({ where: { id: existing.jobRunId } }) : null, replayed: true };
    }
    const execution = await tx.executionRun.create({ data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      automationTaskId: input.automationTaskId,
      mode: input.mode,
      sourceType: input.source.sourceType,
      sourceValue,
      sourceFingerprint
    } });
    const job = await jobService.create(tx, {
      organizationId: input.organizationId,
      type: JobType.AUTONOMOUS_EXECUTION,
      idempotencyKey: `execution:${execution.id}`,
      payload: { executionRunId: execution.id, languageCode: input.source.languageCode, locationCode: input.source.locationCode },
      priceAction: 'AUTONOMOUS_EXECUTION'
    });
    const linked = await tx.executionRun.update({ where: { id: execution.id }, data: { jobRunId: job.id } });
    return { execution: linked, job, replayed: false };
  }
};
