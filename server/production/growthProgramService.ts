import { createHash } from 'crypto';
import {
  CreditHoldStatus,
  GrowthInputType,
  GrowthProgramMode,
  GrowthRunStageCode,
  GrowthRunTrigger,
  JobType
} from '@prisma/client';
import type { TransactionClient } from './prisma';
import { jobService } from './jobService';
import { ConflictError, ValidationError } from '../domain/errors';

export const GROWTH_STAGES = [
  GrowthRunStageCode.UNDERSTAND,
  GrowthRunStageCode.DISCOVER,
  GrowthRunStageCode.DECIDE,
  GrowthRunStageCode.EXECUTE,
  GrowthRunStageCode.LEARN
] as const;

const fingerprint = (parts: string[]): string => createHash('sha256').update(parts.join('\n')).digest('hex');

export type GrowthProgramInputSpec = {
  type: GrowthInputType;
  value: string;
};

const inputLimit: Record<GrowthInputType, number> = {
  [GrowthInputType.KEYWORD]: 20,
  [GrowthInputType.REFERENCE_URL]: 5,
  [GrowthInputType.COMPETITOR_SITE]: 5
};

const normalizeValue = (input: GrowthProgramInputSpec): string => {
  if (input.type === GrowthInputType.KEYWORD) {
    const normalized = input.value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
    if (normalized.length < 2 || normalized.length > 200) throw new ValidationError('关键词长度必须在 2 到 200 个字符之间');
    return normalized;
  }
  let url: URL;
  try {
    url = new URL(input.value.trim());
  } catch {
    throw new ValidationError('参考文章和竞品站点必须是完整的 HTTPS 地址');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new ValidationError('参考文章和竞品站点必须使用不含账号密码的 HTTPS 地址');
  }
  url.hash = '';
  url.hostname = url.hostname.toLocaleLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  const normalized = url.toString();
  if (normalized.length > 2_000) throw new ValidationError('参考文章和竞品站点地址不能超过 2000 个字符');
  return normalized;
};

export const normalizeGrowthProgramInputs = (inputs: GrowthProgramInputSpec[]) => {
  const normalized = [] as Array<GrowthProgramInputSpec & { normalizedValue: string; valueFingerprint: string; position: number }>;
  const seen = new Set<string>();
  const counts = new Map<GrowthInputType, number>();
  for (const input of inputs) {
    const value = input.value.trim();
    if (value.length < 2 || value.length > 2_000) throw new ValidationError('增长线索长度必须在 2 到 2000 个字符之间');
    const normalizedValue = normalizeValue({ ...input, value });
    const dedupeKey = `${input.type}\n${normalizedValue}`;
    if (seen.has(dedupeKey)) continue;
    const nextCount = (counts.get(input.type) || 0) + 1;
    if (nextCount > inputLimit[input.type]) throw new ValidationError(`${input.type} 输入数量超过限制`);
    counts.set(input.type, nextCount);
    seen.add(dedupeKey);
    normalized.push({
      type: input.type,
      value,
      normalizedValue,
      valueFingerprint: fingerprint([input.type, normalizedValue]),
      position: normalized.length
    });
  }
  return normalized;
};

const assertInitialBudget = async (tx: TransactionClient, budgetLimitMicros?: bigint): Promise<void> => {
  if (budgetLimitMicros === undefined) return;
  if (budgetLimitMicros <= 0n) throw new ValidationError('增长程序预算上限必须大于 0');
  const price = await tx.actionPrice.findFirst({ where: { action: 'GROWTH_RUN', active: true }, select: { creditMicros: true } });
  if (!price) throw new ValidationError('增长执行价格尚未配置');
  if (price.creditMicros > budgetLimitMicros) throw new ConflictError('预算上限不足以启动一次正式增长执行');
};

const assertScheduledBudget = async (tx: TransactionClient, programId: string): Promise<void> => {
  const program = await tx.growthProgram.findUniqueOrThrow({
    where: { id: programId },
    select: { budgetLimitMicros: true, runs: { where: { jobRunId: { not: null } }, select: { jobRunId: true } } }
  });
  if (program.budgetLimitMicros === null) return;
  const price = await tx.actionPrice.findFirst({ where: { action: 'GROWTH_RUN', active: true }, select: { creditMicros: true } });
  if (!price) throw new ValidationError('增长执行价格尚未配置');
  const jobRunIds = program.runs.flatMap(({ jobRunId }) => jobRunId ? [jobRunId] : []);
  const committed = jobRunIds.length
    ? (await tx.creditHold.aggregate({
      where: { jobRunId: { in: jobRunIds }, status: { in: [CreditHoldStatus.HELD, CreditHoldStatus.SETTLED] } },
      _sum: { amountMicros: true }
    }))._sum.amountMicros || 0n
    : 0n;
  if (committed + price.creditMicros > program.budgetLimitMicros) {
    throw new ConflictError('持续增长程序已达到预算上限，已停止创建新的付费执行');
  }
};

export const growthProgramService = {
  async create(tx: TransactionClient, input: {
    organizationId: string;
    siteId: string;
    mode: GrowthProgramMode;
    inputs: GrowthProgramInputSpec[];
    occurrenceKey: string;
    budgetLimitMicros?: bigint;
  }) {
    const inputs = normalizeGrowthProgramInputs(input.inputs);
    const canonicalInputs = inputs
      .map(({ type, normalizedValue }) => `${type}:${normalizedValue}`)
      .sort();
    const inputFingerprint = fingerprint([
      input.organizationId,
      input.siteId,
      input.mode,
      ...canonicalInputs,
      input.mode === GrowthProgramMode.ONCE ? input.occurrenceKey : 'continuous'
    ]);
    const existing = await tx.growthProgram.findUnique({
      where: { organizationId_inputFingerprint: { organizationId: input.organizationId, inputFingerprint } },
      include: { inputs: { orderBy: { position: 'asc' } }, runs: { orderBy: { createdAt: 'desc' }, take: 1, include: { stages: { orderBy: { createdAt: 'asc' } } } } }
    });
    if (existing) {
      const run = existing.runs[0] || null;
      return { program: existing, run, job: run?.jobRunId ? await tx.jobRun.findUnique({ where: { id: run.jobRunId } }) : null, replayed: true };
    }
    await assertInitialBudget(tx, input.budgetLimitMicros);
    if (input.mode === GrowthProgramMode.CONTINUOUS) {
      const active = await tx.growthProgram.findFirst({
        where: { siteId: input.siteId, mode: GrowthProgramMode.CONTINUOUS, status: 'ACTIVE' },
        select: { id: true }
      });
      if (active) throw new ConflictError('该站点已有一个持续增长程序，请先暂停现有程序再创建新的持续程序');
    }

    const now = new Date();
    const program = await tx.growthProgram.create({ data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      mode: input.mode,
      inputFingerprint,
      budgetLimitMicros: input.budgetLimitMicros,
      nextRunAt: input.mode === GrowthProgramMode.CONTINUOUS ? new Date(now.getTime() + 7 * 86_400_000) : null,
      inputs: { create: inputs.map(({ type, value, normalizedValue, valueFingerprint, position }) => ({
        organizationId: input.organizationId,
        siteId: input.siteId,
        type,
        value,
        normalizedValue,
        valueFingerprint,
        position
      })) }
    }, include: { inputs: { orderBy: { position: 'asc' } } } });
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
      metadata: {
        mode: input.mode,
        inputTypes: [...new Set(inputs.map(({ type }) => type))],
        inputCount: inputs.length,
        runId: run.id
      }
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
    await assertScheduledBudget(tx, input.programId);
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
