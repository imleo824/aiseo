import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GrowthInputType, GrowthProgramMode, JobStatus } from '@prisma/client';

const createJob = vi.hoisted(() => vi.fn());
vi.mock('./jobService', () => ({ jobService: { create: createJob } }));

beforeEach(() => {
  vi.clearAllMocks();
  createJob.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000004', status: JobStatus.QUEUED, replayed: false });
});

describe('growthProgramService', () => {
  it('creates one priced root job and all five durable stages', async () => {
    const programCreate = vi.fn().mockImplementation(async ({ data }) => ({ id: '00000000-0000-0000-0000-000000000003', ...data }));
    const runCreate = vi.fn().mockImplementation(async ({ data }) => ({ id: '00000000-0000-0000-0000-000000000005', ...data, jobRunId: null, stages: data.stages.create }));
    const tx = {
      growthProgram: { findUnique: vi.fn().mockResolvedValue(null), create: programCreate },
      growthRun: { create: runCreate, update: vi.fn().mockResolvedValue({ id: '00000000-0000-0000-0000-000000000005', jobRunId: '00000000-0000-0000-0000-000000000004' }) },
      auditEvent: { create: vi.fn() }
    };
    const { growthProgramService } = await import('./growthProgramService');
    await growthProgramService.create(tx as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      siteId: '00000000-0000-0000-0000-000000000002',
      mode: GrowthProgramMode.ONCE,
      inputs: [
        { type: GrowthInputType.KEYWORD, value: ' WordPress SEO ' },
        { type: GrowthInputType.REFERENCE_URL, value: 'https://EXAMPLE.com/article/#source' },
        { type: GrowthInputType.COMPETITOR_SITE, value: 'https://competitor.example.com/' }
      ],
      occurrenceKey: 'request-1'
    });

    expect(runCreate.mock.calls[0][0].data.stages.create).toHaveLength(5);
    expect(programCreate.mock.calls[0][0].data).not.toHaveProperty('inputValue');
    expect(programCreate.mock.calls[0][0].data.inputs.create).toEqual([
      expect.objectContaining({ type: GrowthInputType.KEYWORD, value: 'WordPress SEO', normalizedValue: 'wordpress seo', position: 0 }),
      expect.objectContaining({ type: GrowthInputType.REFERENCE_URL, value: 'https://EXAMPLE.com/article/#source', normalizedValue: 'https://example.com/article', position: 1 }),
      expect.objectContaining({ type: GrowthInputType.COMPETITOR_SITE, normalizedValue: 'https://competitor.example.com/', position: 2 })
    ]);
    expect(createJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'GROWTH_RUN', priceAction: 'GROWTH_RUN' }));
  });

  it('replays an existing program without charging or creating another run', async () => {
    const existing = { id: '00000000-0000-0000-0000-000000000003', runs: [{ id: '00000000-0000-0000-0000-000000000005', jobRunId: '00000000-0000-0000-0000-000000000004', stages: [] }] };
    const tx = {
      growthProgram: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn() },
      growthRun: { create: vi.fn(), update: vi.fn() },
      jobRun: { findUnique: vi.fn().mockResolvedValue({ id: existing.runs[0].jobRunId }) },
      auditEvent: { create: vi.fn() }
    };
    const { growthProgramService } = await import('./growthProgramService');
    const result = await growthProgramService.create(tx as never, {
      organizationId: '00000000-0000-0000-0000-000000000001',
      siteId: '00000000-0000-0000-0000-000000000002',
      mode: GrowthProgramMode.ONCE,
      inputs: [{ type: GrowthInputType.KEYWORD, value: 'SEO' }],
      occurrenceKey: 'request-1'
    });
    expect(result.replayed).toBe(true);
    expect(createJob).not.toHaveBeenCalled();
    expect(tx.growthRun.create).not.toHaveBeenCalled();
  });

  it('deduplicates canonical inputs without collapsing different input types', async () => {
    const { normalizeGrowthProgramInputs } = await import('./growthProgramService');
    const normalized = normalizeGrowthProgramInputs([
      { type: GrowthInputType.KEYWORD, value: 'SEO' },
      { type: GrowthInputType.KEYWORD, value: ' seo ' },
      { type: GrowthInputType.REFERENCE_URL, value: 'https://example.com' }
    ]);
    expect(normalized).toHaveLength(2);
    expect(normalized.map(({ type }) => type)).toEqual([GrowthInputType.KEYWORD, GrowthInputType.REFERENCE_URL]);
    expect(normalized.every(({ valueFingerprint }) => /^[a-f0-9]{64}$/.test(valueFingerprint))).toBe(true);
  });

  it('rejects non-HTTPS and credential-bearing external URLs', async () => {
    const { normalizeGrowthProgramInputs } = await import('./growthProgramService');
    expect(() => normalizeGrowthProgramInputs([{ type: GrowthInputType.REFERENCE_URL, value: 'http://example.com/article' }])).toThrow(/HTTPS/);
    expect(() => normalizeGrowthProgramInputs([{ type: GrowthInputType.COMPETITOR_SITE, value: 'https://user:secret@example.com' }])).toThrow(/账号密码/);
  });
});
