import { JobStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { claimQueuedJob, completeClaimedJob, heartbeatClaimedJob } from './jobClaim';

describe('database job claim', () => {
  it('claims only a due queued job and increments its attempt once', async () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    const job = { id: 'job-1', status: JobStatus.RUNNING };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue(job);

    await expect(claimQueuedJob({ jobRun: { updateMany, findUniqueOrThrow } } as never, 'job-1', now)).resolves.toBe(job);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: JobStatus.QUEUED, availableAt: { lte: now } },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        startedAt: now,
        heartbeatAt: now,
        errorCode: null,
        errorMessage: null
      }
    });
    expect(findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('ignores a duplicate or stale queue delivery without reading or executing it', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUniqueOrThrow = vi.fn();

    await expect(claimQueuedJob({ jobRun: { updateMany, findUniqueOrThrow } } as never, 'job-1')).resolves.toBeNull();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('fences heartbeat and completion writes by the claimed attempt', async () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const database = { jobRun: { updateMany } } as never;

    await expect(heartbeatClaimedJob(database, 'job-1', 3, now)).resolves.toBe(true);
    await expect(completeClaimedJob(database, 'job-1', 3, 'result-1', now)).resolves.toBe(true);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'job-1', status: JobStatus.RUNNING, attempts: 3 },
      data: { heartbeatAt: now }
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'job-1', status: JobStatus.RUNNING, attempts: 3 },
      data: { status: JobStatus.SUCCEEDED, result: { resultId: 'result-1' }, finishedAt: now, heartbeatAt: now }
    });
  });

  it('reports a lost claim instead of overwriting a newer attempt', async () => {
    const database = { jobRun: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never;
    await expect(heartbeatClaimedJob(database, 'job-1', 2)).resolves.toBe(false);
    await expect(completeClaimedJob(database, 'job-1', 2)).resolves.toBe(false);
  });
});
