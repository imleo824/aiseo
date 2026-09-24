import { JobStatus } from '@prisma/client';
import type { TransactionClient } from './prisma';

type JobClaimClient = Pick<TransactionClient, 'jobRun'>;

/**
 * Atomically claims a queued database job. BullMQ is a delivery mechanism, not
 * the source of truth, so duplicate or stale queue messages must never be able
 * to move a running, completed or dead-letter job back to RUNNING.
 */
export const claimQueuedJob = async (database: JobClaimClient, jobRunId: string, now = new Date()) => {
  const claimed = await database.jobRun.updateMany({
    where: { id: jobRunId, status: JobStatus.QUEUED, availableAt: { lte: now } },
    data: {
      status: JobStatus.RUNNING,
      attempts: { increment: 1 },
      startedAt: now,
      heartbeatAt: now,
      errorCode: null,
      errorMessage: null
    }
  });
  if (claimed.count !== 1) return null;
  return database.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
};

export const heartbeatClaimedJob = async (
  database: JobClaimClient,
  jobRunId: string,
  attempt: number,
  now = new Date()
): Promise<boolean> => {
  const updated = await database.jobRun.updateMany({
    where: { id: jobRunId, status: JobStatus.RUNNING, attempts: attempt },
    data: { heartbeatAt: now }
  });
  return updated.count === 1;
};

export const completeClaimedJob = async (
  database: JobClaimClient,
  jobRunId: string,
  attempt: number,
  resultId?: string,
  now = new Date()
): Promise<boolean> => {
  const updated = await database.jobRun.updateMany({
    where: { id: jobRunId, status: JobStatus.RUNNING, attempts: attempt },
    data: {
      status: JobStatus.SUCCEEDED,
      result: resultId ? { resultId } : undefined,
      finishedAt: now,
      heartbeatAt: now
    }
  });
  return updated.count === 1;
};
