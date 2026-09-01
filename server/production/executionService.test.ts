import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionMode, ExecutionSourceType, JobStatus } from '@prisma/client';

const createJob = vi.hoisted(() => vi.fn());
vi.mock('./jobService', () => ({ jobService: { create: createJob } }));

beforeEach(() => {
  vi.clearAllMocks();
  createJob.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000004', status: JobStatus.QUEUED, replayed: false });
});

describe('executionService', () => {
  it('creates one durable priced root job with a deterministic fingerprint', async () => {
    const executionCreate = vi.fn().mockImplementation(async ({ data }) => ({ id: '00000000-0000-0000-0000-000000000003', ...data, jobRunId: null }));
    const tx = {
      executionRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: executionCreate,
        update: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000003', jobRunId: '00000000-0000-0000-0000-000000000004' })
      },
      jobRun: { findUnique: vi.fn() }
    };
    const { executionService } = await import('./executionService');
    const input = {
      organizationId: '00000000-0000-0000-0000-000000000001',
      siteId: '00000000-0000-0000-0000-000000000002',
      mode: ExecutionMode.ONCE,
      source: { sourceType: ExecutionSourceType.KEYWORD, sourceValue: 'WordPress SEO', languageCode: 'zh-CN', locationCode: 2840 },
      occurrenceKey: '00000000-0000-0000-0000-000000000005'
    };

    await executionService.create(tx as never, input);
    await executionService.create({ ...tx, executionRun: { ...tx.executionRun, findUnique: vi.fn().mockResolvedValue(null) } } as never, input);

    expect(executionCreate.mock.calls[0][0].data.sourceFingerprint).toBe(executionCreate.mock.calls[1][0].data.sourceFingerprint);
    expect(createJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ priceAction: 'AUTONOMOUS_EXECUTION' }));
  });

  it('returns an existing execution without creating another job', async () => {
    const existing = { id: '00000000-0000-0000-0000-000000000003', jobRunId: '00000000-0000-0000-0000-000000000004' };
    const tx = {
      executionRun: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn(), update: vi.fn() },
      jobRun: { findUnique: vi.fn().mockResolvedValue({ id: existing.jobRunId }) }
    };
    const { executionService } = await import('./executionService');
    const result = await executionService.create(tx as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      siteId: '00000000-0000-0000-0000-000000000002',
      mode: ExecutionMode.ONCE,
      source: { sourceType: ExecutionSourceType.KEYWORD, sourceValue: 'SEO', languageCode: 'zh-CN', locationCode: 2840 },
      occurrenceKey: 'request-1'
    });
    expect(result.replayed).toBe(true);
    expect(createJob).not.toHaveBeenCalled();
  });
});
