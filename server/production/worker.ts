import { createHash, randomUUID } from 'crypto';
import { DataSource, DataStatus, DraftStatus, ExecutionMode, ExecutionSourceType, ExecutionStage, ExecutionStatus, GrowthActionStatus, GrowthCycleStatus, GrowthCycleTrigger, GrowthStage, GrowthStateStatus, JobStatus, JobType, PaymentStatus, Prisma, PublishAttemptStatus, PublishPolicy, SiteConnectionStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { billingService } from './billingService';
import { contentAi } from './contentAi';
import { decryptSecret } from './crypto';
import { dataForSeoProvider, gscProvider, tronGridProvider } from './providers';
import { closeQueue, getProductionQueue, getQueueConnection, PRODUCTION_QUEUE, productionJobOptions } from './queue';
import { assertProductionConfiguration, productionConfigurationStatus, productionConfigurationWarnings } from './env';
import { disconnectWorkerDatabase, workerPrisma } from './workerPrisma';
import { wordPressService } from './wordpress';
import { logger } from '../utils/logger';
import { jobService } from './jobService';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { assertDatabaseSecurity } from './databaseSecurity';
import { addDays, autonomyDecision, discoverGscOpportunities, gscComparisonWindow, GROWTH_SCORE_VERSION, planMinimumEffectiveAction, readGscRows } from './growthEngine';
import { growthService } from './growthService';
import { executionService } from './executionService';
import { capturePublicSource } from './sourceFetcher';
import { selectRelevantInternalLinks } from './seoPipeline';
import { ValidationError } from '../domain/errors';
import { nextAutomationRun } from './schedule';

type QueuePayload = { jobRunId?: string; system?: boolean };
const workerId = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID().slice(0, 8)}`;
const startedAt = new Date();
if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, release: process.env.RAILWAY_GIT_COMMIT_SHA, tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1), sendDefaultPii: false });

const reconcile = async (): Promise<void> => {
  const queue = getProductionQueue();
  const capabilities = productionConfigurationStatus('worker').providers;
  await workerPrisma.workerHeartbeat.upsert({ where: { workerId }, create: { workerId, queues: [PRODUCTION_QUEUE], processVersion: process.env.RAILWAY_GIT_COMMIT_SHA || 'development', capabilities, heartbeatAt: new Date(), startedAt }, update: { heartbeatAt: new Date(), queues: [PRODUCTION_QUEUE], capabilities } });
  await workerPrisma.paymentIntent.updateMany({ where: { status: { in: [PaymentStatus.AWAITING_TRANSFER, PaymentStatus.VERIFYING] }, expiresAt: { lt: new Date() } }, data: { status: PaymentStatus.EXPIRED } });
  const deletionCandidates = await workerPrisma.profile.findMany({ where: { deletionRequestedAt: { lte: new Date(Date.now() - 30 * 86_400_000) } }, select: { id: true } });
  for (const profile of deletionCandidates) {
    const organizationIds = (await workerPrisma.organizationMember.findMany({ where: { profileId: profile.id }, select: { organizationId: true } })).map(({ organizationId }) => organizationId);
    const pseudonym = createHash('sha256').update(profile.id).digest('hex').slice(0, 16);
    await workerPrisma.$transaction(async (tx) => {
      await tx.growthObservation.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.growthAction.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.growthDecision.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.growthCycle.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.siteGrowthState.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.contentDraft.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.opportunity.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.keywordScan.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.dataSnapshot.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.knowledgeSource.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.site.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.notification.deleteMany({ where: { profileId: profile.id } });
      await tx.idempotencyKey.deleteMany({ where: { profileId: profile.id } });
      await tx.termsAcceptance.deleteMany({ where: { profileId: profile.id } });
      await tx.jobRun.updateMany({ where: { organizationId: { in: organizationIds } }, data: { payload: { redacted: true }, result: Prisma.DbNull, errorMessage: null } });
      await tx.auditEvent.updateMany({ where: { organizationId: { in: organizationIds } }, data: { metadata: { redacted: true } } });
      for (const organizationId of organizationIds) await tx.organization.update({ where: { id: organizationId }, data: { name: `Deleted organization ${pseudonym}`, disabledAt: new Date() } });
      await tx.auditEvent.create({ data: { action: 'ACCOUNT_DATA_ERASED', targetType: 'profile_hash', targetId: pseudonym, metadata: { retained: ['ledger', 'payment_intent', 'audit_event'] } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  await workerPrisma.jobRun.updateMany({ where: { status: JobStatus.RUNNING, heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) }, attempts: { lt: 5 } }, data: { status: JobStatus.QUEUED, queueJobId: null, errorCode: 'STALE_WORKER_RECOVERED', errorMessage: 'Recovered from stale worker heartbeat' } });
  await workerPrisma.jobRun.updateMany({ where: { status: JobStatus.RUNNING, heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) }, attempts: { gte: 5 } }, data: { status: JobStatus.DEAD_LETTER, finishedAt: new Date(), errorCode: 'MAX_ATTEMPTS_EXCEEDED' } });
  const [queuedCount, ledgerDifferences] = await Promise.all([
    workerPrisma.jobRun.count({ where: { status: JobStatus.QUEUED } }),
    workerPrisma.$queryRaw<Array<{ organization_id: string; balance: bigint; ledger_balance: bigint | null }>>`
      SELECT organization.id AS organization_id,
             organization.credit_balance_micros AS balance,
             latest.balance_after_micros AS ledger_balance
      FROM public.organizations organization
      LEFT JOIN LATERAL (
        SELECT balance_after_micros FROM public.ledger_entries entry
        WHERE entry.organization_id = organization.id ORDER BY entry.created_at DESC, entry.id DESC LIMIT 1
      ) latest ON true
      WHERE organization.credit_balance_micros <> coalesce(latest.balance_after_micros, 0)
    `
  ]);
  if (queuedCount > Number(process.env.QUEUE_BACKLOG_ALERT_THRESHOLD || 100)) Sentry.captureMessage(`AISEO queue backlog: ${queuedCount}`, 'warning');
  if (ledgerDifferences.length) Sentry.captureMessage(`AISEO ledger reconciliation mismatch in ${ledgerDifferences.length} organizations`, { level: 'fatal', extra: { organizationIds: ledgerDifferences.map(({ organization_id }) => organization_id) } });

  const claimedTasks = await workerPrisma.$transaction((tx) => tx.$queryRaw<Array<{ id: string }>>`
    WITH due AS (
      SELECT id FROM public.automation_tasks
      WHERE status = 'ACTIVE' AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    )
    UPDATE public.automation_tasks task
    SET locked_until = now() + interval '5 minutes'
    FROM due
    WHERE task.id = due.id
    RETURNING task.id
  `, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (const { id } of claimedTasks) {
    try {
      await workerPrisma.$transaction(async (tx) => {
        const task = await tx.automationTask.findUniqueOrThrow({ where: { id } });
        if (task.status !== 'ACTIVE') return;
        const site = await tx.site.findUniqueOrThrow({ where: { id: task.siteId } });
        if (site.publishPolicy !== PublishPolicy.AUTO_PUBLISH) throw new Error('站点未启用自动发布');
        const config = task.scheduleConfig as { sourceType?: string; sourceValue?: string; languageCode?: string; locationCode?: number };
        if (!config.sourceType || !Object.values(ExecutionSourceType).includes(config.sourceType as ExecutionSourceType) || !config.sourceValue || !config.languageCode || !Number.isInteger(config.locationCode) || !config.locationCode) {
          throw new Error('自动任务缺少有效作业类型');
        }
        const idempotencyKey = `automation:${task.id}:${task.nextRunAt.toISOString()}`;
        await executionService.create(tx, {
          organizationId: task.organizationId,
          siteId: task.siteId,
          mode: ExecutionMode.SCHEDULED,
          source: { sourceType: config.sourceType as ExecutionSourceType, sourceValue: config.sourceValue, languageCode: config.languageCode, locationCode: config.locationCode },
          occurrenceKey: idempotencyKey,
          automationTaskId: task.id
        });
        await tx.automationTask.update({ where: { id }, data: { lastRunAt: new Date(), nextRunAt: nextAutomationRun(task.nextRunAt, task.scheduleType, task.scheduleConfig as { minutes?: number; time?: string; timezone?: string }), lockedUntil: null, lastError: null } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await workerPrisma.automationTask.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'PAUSED', lockedUntil: null, lastError: message.slice(0, 1_000) } });
      Sentry.captureException(error, { tags: { subsystem: 'automation-reconcile', automationTaskId: id } });
    }
  }

  // Growth is state/data driven. A due state only creates a cycle when a new
  // immutable GSC snapshot exists; a timer alone never fabricates work.
  await workerPrisma.$transaction(async (tx) => {
    const dueStates = await tx.siteGrowthState.findMany({
      where: { status: { in: [GrowthStateStatus.ACTIVE, GrowthStateStatus.OBSERVING] }, nextDecisionAt: { lte: new Date() } },
      orderBy: { nextDecisionAt: 'asc' }, take: 50
    });
    for (const state of dueStates) {
      const latest = await tx.dataSnapshot.findFirst({ where: { organizationId: state.organizationId, siteId: state.siteId, source: DataSource.GSC, status: DataStatus.LIVE, comparisonSnapshotId: { not: null } }, orderBy: [{ periodEnd: 'desc' }, { fetchedAt: 'desc' }] });
      if (!latest || (state.lastDataWatermark && latest.fetchedAt <= state.lastDataWatermark)) {
        const connection = await tx.integrationConnection.findFirst({ where: { organizationId: state.organizationId, siteId: state.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED } });
        if (!connection?.propertyId) {
          await tx.siteGrowthState.update({ where: { id: state.id }, data: { status: GrowthStateStatus.BLOCKED, blockedReason: 'GSC_CONNECTION_REQUIRED', nextDecisionAt: null } });
          continue;
        }
        const end = new Date(Date.now() - 3 * 86_400_000);
        const start = new Date(end.getTime() - 27 * 86_400_000);
        const date = (value: Date) => value.toISOString().slice(0, 10);
        await jobService.create(tx, {
          organizationId: state.organizationId,
          type: JobType.GSC_SYNC,
          idempotencyKey: `growth-refresh:${state.siteId}:${date(end)}`,
          payload: { connectionId: connection.id, siteId: state.siteId, growthRefresh: true, startDate: date(start), endDate: date(end) }
        });
        await tx.siteGrowthState.update({ where: { id: state.id }, data: { nextDecisionAt: addDays(new Date(), 1), blockedReason: null } });
        continue;
      }
      await growthService.createCycle(tx, { organizationId: state.organizationId, siteId: state.siteId, trigger: GrowthCycleTrigger.DATA_CHANGE, idempotencyKey: `growth:${state.siteId}:${latest.id}`, inputWatermark: latest.fetchedAt });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const queued = await workerPrisma.jobRun.findMany({ where: { status: JobStatus.QUEUED, availableAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 500 });
  for (const run of queued) {
    const queueJob = await queue.add(run.type, { jobRunId: run.id }, productionJobOptions(run.id));
    await workerPrisma.jobRun.update({ where: { id: run.id }, data: { queueJobId: String(queueJob.id) } });
  }
};

const markFailed = async (runId: string, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  await workerPrisma.$transaction(async (tx) => {
    const run = await tx.jobRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const finalAttempt = run.attempts >= 5;
    await tx.jobRun.update({ where: { id: runId }, data: { status: finalAttempt ? JobStatus.DEAD_LETTER : JobStatus.QUEUED, errorCode: 'JOB_EXECUTION_FAILED', errorMessage: message, finishedAt: finalAttempt ? new Date() : null } });
    if (finalAttempt) await billingService.releaseCreditHold(tx, runId);
    if (finalAttempt && run.type === JobType.WORDPRESS_PUBLISH) {
      await tx.publishAttempt.updateMany({ where: { jobRunId: runId }, data: { status: PublishAttemptStatus.FAILED, errorCode: 'WORDPRESS_PUBLISH_FAILED', errorMessage: message, finishedAt: new Date() } });
      const payload = run.payload as { draftId?: string };
      if (payload.draftId) {
        await tx.contentDraft.updateMany({ where: { id: payload.draftId }, data: { status: DraftStatus.PUBLISH_FAILED } });
        const executions = await tx.executionRun.findMany({ where: { organizationId: run.organizationId, draftId: payload.draftId }, select: { id: true, automationTaskId: true } });
        for (const execution of executions) {
          await tx.executionRun.update({ where: { id: execution.id }, data: { status: ExecutionStatus.FAILED, errorCode: 'WORDPRESS_PUBLISH_FAILED', errorMessage: message, finishedAt: new Date() } });
          if (execution.automationTaskId) await tx.automationTask.updateMany({ where: { id: execution.automationTaskId, status: 'ACTIVE' }, data: { status: 'PAUSED', lastError: message } });
          await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'AUTONOMOUS_PUBLISH_FAILED', targetType: 'execution_run', targetId: execution.id, metadata: { draftId: payload.draftId, jobRunId: runId } } });
        }
      }
    }
    if (finalAttempt && run.type === JobType.INDEXING_MONITOR) {
      const payload = run.payload as { draftId?: string };
      if (payload.draftId) {
        const executions = await tx.executionRun.findMany({ where: { organizationId: run.organizationId, draftId: payload.draftId }, select: { id: true, automationTaskId: true } });
        for (const execution of executions) {
          await tx.executionRun.update({ where: { id: execution.id }, data: { status: ExecutionStatus.FAILED, errorCode: 'INDEXING_MONITOR_FAILED', errorMessage: message, finishedAt: new Date() } });
          if (execution.automationTaskId) await tx.automationTask.updateMany({ where: { id: execution.automationTaskId, status: 'ACTIVE' }, data: { status: 'PAUSED', lastError: message } });
          await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'AUTONOMOUS_MONITORING_FAILED', targetType: 'execution_run', targetId: execution.id, metadata: { draftId: payload.draftId, jobRunId: runId } } });
        }
      }
    }
    if (finalAttempt && run.type === JobType.GROWTH_CYCLE) {
      const payload = run.payload as { cycleId?: string; siteId?: string };
      if (payload.cycleId) await tx.growthCycle.updateMany({ where: { id: payload.cycleId, organizationId: run.organizationId }, data: { status: GrowthCycleStatus.FAILED, errorCode: 'GROWTH_CYCLE_FAILED', errorMessage: message, finishedAt: new Date() } });
      if (payload.siteId) await tx.siteGrowthState.updateMany({ where: { siteId: payload.siteId, organizationId: run.organizationId }, data: { status: GrowthStateStatus.BLOCKED, blockedReason: message, nextDecisionAt: null } });
    }
    if (finalAttempt && run.type === JobType.GROWTH_ACTION_EXECUTE) {
      const payload = run.payload as { actionId?: string };
      if (payload.actionId) await tx.growthAction.updateMany({ where: { id: payload.actionId, organizationId: run.organizationId }, data: { status: GrowthActionStatus.FAILED, afterSnapshot: { errorCode: 'GROWTH_ACTION_FAILED', message } } });
    }
    if (finalAttempt && run.type === JobType.GSC_SYNC) {
      const payload = run.payload as { connectionId?: string };
      if (payload.connectionId) await tx.integrationConnection.updateMany({ where: { id: payload.connectionId, organizationId: run.organizationId }, data: { status: SiteConnectionStatus.FAILED, lastErrorCode: 'GSC_SYNC_FAILED', lastErrorMessage: message } });
    }
    if (finalAttempt && run.type === JobType.AUTONOMOUS_EXECUTION) {
      const payload = run.payload as { executionRunId?: string };
      if (payload.executionRunId) {
        const execution = await tx.executionRun.findFirst({ where: { id: payload.executionRunId, organizationId: run.organizationId } });
        if (execution) {
          await tx.executionRun.update({ where: { id: execution.id }, data: { status: ExecutionStatus.FAILED, errorCode: 'AUTONOMOUS_EXECUTION_FAILED', errorMessage: message, finishedAt: new Date() } });
          if (execution.automationTaskId) await tx.automationTask.updateMany({ where: { id: execution.automationTaskId, status: 'ACTIVE' }, data: { status: 'PAUSED', lastError: message } });
        }
      }
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const processKeywordScan = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { keywordScanId?: string; siteId?: string; seedKeyword?: string; languageCode?: string; locationCode?: number; automationTaskId?: string };
  if (!payload.keywordScanId || !payload.siteId || !payload.seedKeyword || !payload.languageCode || !payload.locationCode) throw new Error('关键词扫描参数不完整');
  const metrics = await dataForSeoProvider.scanKeyword({ keyword: payload.seedKeyword, languageCode: payload.languageCode, locationCode: payload.locationCode });
  return workerPrisma.$transaction(async (tx) => {
    const snapshot = await tx.dataSnapshot.create({ data: { organizationId: run.organizationId, siteId: payload.siteId, source: DataSource.DATAFORSEO, status: DataStatus.LIVE, formulaVersion: 'seo-metrics-1', fetchedAt: new Date(metrics.fetchedAt), payload: metrics as Prisma.InputJsonValue } });
    const volume = BigInt(Math.max(0, metrics.searchVolume));
    const roi = BigInt(Math.max(0, 100 - metrics.keywordDifficulty)) * volume * 1_000_000n / BigInt(metrics.allintitleCount + 1);
    const opportunity = await tx.opportunity.create({ data: { organizationId: run.organizationId, siteId: payload.siteId, keywordScanId: payload.keywordScanId, snapshotId: snapshot.id, type: 'KGR', title: metrics.keyword, keyword: metrics.keyword, searchVolume: metrics.searchVolume, keywordDifficulty: metrics.keywordDifficulty, allintitleCount: metrics.allintitleCount, kgrNumerator: BigInt(metrics.allintitleCount), kgrDenominator: volume, roiScoreMicros: roi, formulaVersion: 'kgr-roi-1', evidence: { source: 'DATAFORSEO', snapshotId: snapshot.id } } });
    await tx.keywordScan.update({ where: { id: payload.keywordScanId }, data: { snapshotId: snapshot.id, status: JobStatus.SUCCEEDED, resultCount: 1, completedAt: new Date() } });
    await billingService.settleCreditHold(tx, runId, 'opportunity', opportunity.id);
    if (payload.automationTaskId) {
      const task = await tx.automationTask.findFirst({ where: { id: payload.automationTaskId, organizationId: run.organizationId, siteId: payload.siteId, status: 'ACTIVE' } });
      const sources = await tx.knowledgeSource.findMany({ where: { organizationId: run.organizationId, status: DataStatus.LIVE, OR: [{ siteId: payload.siteId }, { siteId: null }] }, select: { id: true }, take: 20 });
      if (!task || !sources.length) {
        if (task) await tx.automationTask.update({ where: { id: task.id }, data: { status: 'PAUSED', lastError: '自动内容流程需要至少一个真实知识来源' } });
        await tx.notification.create({ data: { organizationId: run.organizationId, type: 'AUTOMATION_PAUSED', title: '自动任务已暂停', message: '未找到可用的真实知识来源，未生成内容。', metadata: { automationTaskId: payload.automationTaskId, opportunityId: opportunity.id } } });
      } else {
        await jobService.create(tx, { organizationId: run.organizationId, type: JobType.CONTENT_GENERATION, idempotencyKey: `automation-content:${payload.automationTaskId}:${opportunity.id}`, payload: { siteId: payload.siteId, opportunityId: opportunity.id, knowledgeSourceIds: sources.map(({ id }) => id), seoSnapshotId: snapshot.id, keyword: metrics.keyword, automationTaskId: payload.automationTaskId }, priceAction: 'CONTENT_GENERATION' });
      }
    }
    return opportunity.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const processGrowthCycle = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { cycleId?: string; siteId?: string };
  if (!payload.cycleId || !payload.siteId) throw new Error('增长周期参数不完整');
  const [cycle, state, site, currentSnapshot, knowledge] = await Promise.all([
    workerPrisma.growthCycle.findFirst({ where: { id: payload.cycleId, organizationId: run.organizationId, siteId: payload.siteId } }),
    workerPrisma.siteGrowthState.findFirst({ where: { organizationId: run.organizationId, siteId: payload.siteId } }),
    workerPrisma.site.findFirst({ where: { id: payload.siteId, organizationId: run.organizationId } }),
    workerPrisma.dataSnapshot.findFirst({
      where: { organizationId: run.organizationId, siteId: payload.siteId, source: DataSource.GSC, status: DataStatus.LIVE, comparisonSnapshotId: { not: null } },
      include: { comparisonSnapshot: true },
      orderBy: [{ periodEnd: 'desc' }, { fetchedAt: 'desc' }]
    }),
    workerPrisma.knowledgeSource.findMany({ where: { organizationId: run.organizationId, status: DataStatus.LIVE, OR: [{ siteId: payload.siteId }, { siteId: null }] }, select: { id: true, title: true, summary: true, content: true }, take: 100 })
  ]);
  if (!cycle || !state || !site) throw new Error('增长周期、站点或长期状态不存在');
  if (state.status === GrowthStateStatus.PAUSED) throw new Error('站点增长已暂停');
  if (!currentSnapshot?.comparisonSnapshot) throw new Error('缺少成对的真实 GSC 比较快照，增长周期已失败关闭');
  const currentRows = readGscRows(currentSnapshot.payload);
  if (!currentRows.length) throw new Error('GSC 快照没有可验证的查询与页面指标');
  if (!knowledge.length) throw new Error('缺少客户业务知识，不能计算有效流量机会');

  await workerPrisma.growthCycle.update({ where: { id: cycle.id }, data: { status: GrowthCycleStatus.RUNNING, stage: GrowthStage.OPPORTUNITY, startedAt: new Date(), inputWatermark: currentSnapshot.fetchedAt } });
  const businessCorpus = knowledge.map((item) => `${item.title}\n${item.summary || ''}\n${item.content}`).join('\n');
  const candidates = discoverGscOpportunities({ current: currentRows, previous: readGscRows(currentSnapshot.comparisonSnapshot.payload), businessCorpus }).slice(0, 500);
  const corpusChecksum = createHash('sha256').update(businessCorpus).digest('hex');

  await workerPrisma.$transaction(async (tx) => {
    const persisted = [];
    for (const candidate of candidates) {
      persisted.push(await tx.opportunity.upsert({
        where: { siteId_sourceKey: { siteId: site.id, sourceKey: candidate.sourceKey } },
        create: {
          organizationId: run.organizationId, siteId: site.id, snapshotId: currentSnapshot.id,
          sourceKey: candidate.sourceKey, type: candidate.type, title: candidate.title, targetUrl: candidate.targetUrl, keyword: candidate.keyword,
          evidence: candidate.evidence as Prisma.InputJsonValue, trafficPotentialMicros: candidate.trafficPotentialMicros,
          businessRelevanceMicros: candidate.businessRelevanceMicros, successProbabilityMicros: candidate.successProbabilityMicros,
          confidenceMicros: candidate.confidenceMicros, executionCostMicros: candidate.executionCostMicros,
          riskPenaltyMicros: candidate.riskPenaltyMicros, expectedValueMicros: candidate.expectedValueMicros,
          timeToImpactDays: candidate.timeToImpactDays, formulaVersion: candidate.formulaVersion
        },
        update: {
          snapshotId: currentSnapshot.id, status: 'OPEN', title: candidate.title, targetUrl: candidate.targetUrl, keyword: candidate.keyword,
          evidence: candidate.evidence as Prisma.InputJsonValue, trafficPotentialMicros: candidate.trafficPotentialMicros,
          businessRelevanceMicros: candidate.businessRelevanceMicros, successProbabilityMicros: candidate.successProbabilityMicros,
          confidenceMicros: candidate.confidenceMicros, executionCostMicros: candidate.executionCostMicros,
          riskPenaltyMicros: candidate.riskPenaltyMicros, expectedValueMicros: candidate.expectedValueMicros,
          timeToImpactDays: candidate.timeToImpactDays, formulaVersion: candidate.formulaVersion
        }
      }));
    }

    let selectedCount = 0;
    let reviewCount = 0;
    let rejectedCount = 0;
    for (const [index, opportunity] of persisted.slice(0, 10).entries()) {
      const candidate = candidates[index];
      const plan = planMinimumEffectiveAction(candidate);
      const cooling = await tx.growthAction.findFirst({
        where: { siteId: site.id, targetUrl: candidate.targetUrl, cooldownUntil: { gt: new Date() }, status: { in: [GrowthActionStatus.EXECUTING, GrowthActionStatus.VERIFYING, GrowthActionStatus.OBSERVING, GrowthActionStatus.SUCCEEDED] } },
        select: { id: true, cooldownUntil: true }
      });
      const decision = await tx.growthDecision.create({
        data: {
          organizationId: run.organizationId, siteId: site.id, cycleId: cycle.id, opportunityId: opportunity.id,
          status: cooling ? 'DEFERRED' : 'SELECTED', rank: index + 1, scoreMicros: opportunity.expectedValueMicros || 0n,
          scoreVersion: GROWTH_SCORE_VERSION, selectedActionType: plan.type,
          rationale: { evidenceOnly: true, opportunityType: candidate.type, formulaVersion: candidate.formulaVersion, coolingActionId: cooling?.id, cooldownUntil: cooling?.cooldownUntil?.toISOString() } as Prisma.InputJsonValue
        }
      });
      if (cooling) continue;
      const hasVerifiedDiagnosticExecutor = site.wordpressStatus === SiteConnectionStatus.CONNECTED
        && Boolean(site.wordpressVerifiedAt)
        && Boolean(site.wordpressCredentials);
      // Mutation execution remains disabled until the action plan contains an
      // exact proposed value, a before-snapshot and a verified rollback path.
      const autonomy = autonomyDecision({ action: plan, autonomyLevel: state.autonomyLevel, hasVerifiedMutationExecutor: false, hasVerifiedDiagnosticExecutor });
      const actionStatus = autonomy === 'REJECT' ? GrowthActionStatus.CANCELLED : autonomy === 'REQUIRE_REVIEW' ? GrowthActionStatus.REVIEW_REQUIRED : GrowthActionStatus.APPROVED;
      const action = await tx.growthAction.create({
        data: {
          organizationId: run.organizationId, siteId: site.id, cycleId: cycle.id, decisionId: decision.id, opportunityId: opportunity.id,
          type: plan.type, status: actionStatus, riskLevel: plan.riskLevel, autonomyDecision: autonomy,
          targetUrl: candidate.targetUrl, reversible: plan.reversible, expectedValueMicros: opportunity.expectedValueMicros,
          plan: { ...plan.plan, blockedBy: autonomy === 'REJECT' ? (plan.type === 'DIAGNOSE_ONLY' ? 'VERIFIED_WORDPRESS_READ_EXECUTOR_REQUIRED' : 'VERIFIED_ATOMIC_WORDPRESS_MUTATION_REQUIRED') : undefined } as Prisma.InputJsonValue,
          cooldownUntil: addDays(new Date(), plan.observationDays)
        }
      });
      if (autonomy === 'AUTO_EXECUTE') {
        await jobService.create(tx, { organizationId: run.organizationId, type: JobType.GROWTH_ACTION_EXECUTE, idempotencyKey: `growth-action:${action.id}`, payload: { actionId: action.id } });
        selectedCount += 1;
      } else if (autonomy === 'REQUIRE_REVIEW') reviewCount += 1;
      else rejectedCount += 1;
    }

    const now = new Date();
    await tx.siteGrowthState.update({ where: { id: state.id }, data: {
      status: GrowthStateStatus.ACTIVE, stateVersion: { increment: 1 },
      businessProfile: { evidence: 'CUSTOMER_KNOWLEDGE', sourceIds: knowledge.map(({ id }) => id), corpusChecksum, generatedFacts: false },
      baselineCompletedAt: state.baselineCompletedAt || now, lastCycleAt: now, lastDataWatermark: currentSnapshot.fetchedAt,
      nextDecisionAt: addDays(now, 1), blockedReason: null
    } });
    await tx.growthCycle.update({ where: { id: cycle.id }, data: {
      status: GrowthCycleStatus.SUCCEEDED, stage: GrowthStage.DECISION, finishedAt: now,
      summary: { source: 'GSC', sourceSnapshotId: currentSnapshot.id, previousSnapshotId: currentSnapshot.comparisonSnapshot.id, comparisonType: 'ADJACENT_NON_OVERLAPPING_PERIODS', realityRows: currentRows.length, qualifiedOpportunities: candidates.length, selectedActions: selectedCount, reviewRequired: reviewCount, rejectedActions: rejectedCount, attributionClaimed: false } as Prisma.InputJsonValue
    } });
    await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'GROWTH_CYCLE_COMPLETED', targetType: 'growth_cycle', targetId: cycle.id, metadata: { sourceSnapshotId: currentSnapshot.id, comparisonSnapshotId: currentSnapshot.comparisonSnapshot.id, opportunityCount: candidates.length, selectedCount, reviewCount, rejectedCount } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return cycle.id;
};

const processGrowthAction = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const actionId = (run.payload as { actionId?: string }).actionId;
  if (!actionId) throw new Error('增长动作缺少 actionId');
  const action = await workerPrisma.growthAction.findFirst({ where: { id: actionId, organizationId: run.organizationId }, include: { opportunity: true, site: true } });
  if (!action || action.status !== GrowthActionStatus.APPROVED) throw new Error('增长动作不存在或未通过执行门禁');
  if (action.type !== 'DIAGNOSE_ONLY') throw new Error('动作缺少精确变更值、前置快照或回滚路径，禁止执行站点变更');
  if (!action.targetUrl || !action.site.wordpressCredentials || action.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !action.site.wordpressVerifiedAt) throw new Error('WordPress 诊断执行器不可用');
  const diagnosis = await wordPressService.inspectTarget({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, targetUrl: action.targetUrl });
  await workerPrisma.$transaction(async (tx) => {
    await tx.growthAction.update({ where: { id: action.id }, data: {
      status: GrowthActionStatus.SUCCEEDED, executedAt: new Date(), verifiedAt: new Date(),
      beforeSnapshot: diagnosis,
      afterSnapshot: { outcome: 'PAGE_DIGITAL_TWIN_CAPTURED', mutationPerformed: false, source: 'WORDPRESS_REST_EDIT_CONTEXT', sourceOpportunityId: action.opportunityId }
    } });
    await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'GROWTH_PAGE_DIAGNOSED', targetType: 'growth_action', targetId: action.id, metadata: { mutationPerformed: false, source: 'WORDPRESS_REST_EDIT_CONTEXT', postId: diagnosis.postId, contentChecksum: diagnosis.contentChecksum } } });
  });
  return action.id;
};

const processAutonomousExecution = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { executionRunId?: string; languageCode?: string; locationCode?: number };
  if (!payload.executionRunId || !payload.languageCode || !payload.locationCode) throw new Error('全自动执行参数不完整');
  let execution = await workerPrisma.executionRun.findFirst({ where: { id: payload.executionRunId, organizationId: run.organizationId }, include: { site: true, automationTask: true } });
  if (!execution) throw new Error('全自动执行单不存在');
  if (execution.status === ExecutionStatus.SUCCEEDED || execution.status === ExecutionStatus.CANCELLED) return execution.id;
  await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { status: ExecutionStatus.RUNNING, startedAt: execution.startedAt || new Date(), errorCode: null, errorMessage: null } });

  const sourceIds = [...execution.knowledgeSourceIds];
  const captureAndPersist = async (url: string, prefix: '[TARGET_SITE]' | '[REFERENCE]' | '[COMPETITOR]', capturedInput?: Awaited<ReturnType<typeof capturePublicSource>>): Promise<string> => {
    const captured = capturedInput || await capturePublicSource(url);
    const existing = await workerPrisma.knowledgeSource.findUnique({ where: { organizationId_checksum: { organizationId: run.organizationId, checksum: captured.checksum } } });
    if (existing) return existing.id;
    const created = await workerPrisma.knowledgeSource.create({ data: {
      organizationId: run.organizationId,
      siteId: execution!.siteId,
      type: 'ALLOWLISTED_URL',
      title: `${prefix} ${captured.title}`.slice(0, 200),
      sourceUrl: url,
      normalizedUrl: captured.normalizedUrl,
      content: captured.content,
      summary: captured.content.slice(0, 500),
      checksum: captured.checksum,
      fetchedAt: new Date(captured.fetchedAt)
    } });
    return created.id;
  };

  if (!sourceIds.length) {
    await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { stage: ExecutionStage.SOURCE_CAPTURE } });
    if (execution.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !execution.site.wordpressCredentials || !execution.site.wordpressVerifiedAt) throw new Error('WordPress 连接未通过验证，无法读取真实站点上下文');
    const targetContext = await wordPressService.readSiteContext(execution.site.domain, execution.site.wordpressCredentials).catch((error) => {
      if (error instanceof ValidationError && error.message.includes('没有足够的已发布内容')) return capturePublicSource(execution!.site.domain);
      throw error;
    });
    sourceIds.push(await captureAndPersist(execution.site.domain, '[TARGET_SITE]', targetContext));
    if (execution.sourceType === ExecutionSourceType.REWRITE_URL && execution.sourceValue) sourceIds.push(await captureAndPersist(execution.sourceValue, '[REFERENCE]'));
    if (execution.sourceType === ExecutionSourceType.COMPETITOR_URL && execution.sourceValue) sourceIds.push(await captureAndPersist(execution.sourceValue, '[COMPETITOR]'));
    await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { knowledgeSourceIds: sourceIds } });
  }

  const knowledge = await workerPrisma.knowledgeSource.findMany({ where: { id: { in: sourceIds }, organizationId: run.organizationId, status: DataStatus.LIVE } });
  if (knowledge.length !== sourceIds.length) throw new Error('执行来源未完整保存，任务已失败关闭');
  const comparableSource = (value?: string | null): string | undefined => {
    if (!value) return undefined;
    try {
      const url = new URL(value.startsWith('https://') ? value : `https://${value}`);
      url.hash = '';
      url.pathname = url.pathname.replace(/\/+$/, '') || '/';
      return url.toString();
    } catch { return undefined; }
  };
  const requestedSource = comparableSource(execution.sourceValue);
  const targetHost = execution.site.domain.replace(/^www\./, '').toLowerCase();
  const decoratedKnowledge = knowledge.map((source) => {
    const normalized = comparableSource(source.normalizedUrl || source.sourceUrl);
    let prefix: '[TARGET_SITE]' | '[REFERENCE]' | '[COMPETITOR]' = '[TARGET_SITE]';
    if (requestedSource && normalized === requestedSource && execution.sourceType === ExecutionSourceType.REWRITE_URL) prefix = '[REFERENCE]';
    else if (requestedSource && normalized === requestedSource && execution.sourceType === ExecutionSourceType.COMPETITOR_URL) prefix = '[COMPETITOR]';
    else {
      try {
        const host = new URL(normalized || '').hostname.replace(/^www\./, '').toLowerCase();
        if (host !== targetHost) prefix = execution.sourceType === ExecutionSourceType.REWRITE_URL ? '[REFERENCE]' : '[COMPETITOR]';
      } catch { /* The source remains target-site evidence. */ }
    }
    return { ...source, decoratedTitle: `${prefix} ${source.title.replace(/^\[(?:TARGET_SITE|REFERENCE|COMPETITOR)\]\s*/, '')}` };
  });
  let keyword = execution.resolvedKeyword;
  if (!keyword) {
    if (execution.sourceType === ExecutionSourceType.KEYWORD) keyword = execution.sourceValue || undefined;
    else {
      const prefix = execution.sourceType === ExecutionSourceType.REWRITE_URL ? '[REFERENCE]' : execution.sourceType === ExecutionSourceType.COMPETITOR_URL ? '[COMPETITOR]' : '[TARGET_SITE]';
      const primary = decoratedKnowledge.find(({ decoratedTitle }) => decoratedTitle.startsWith(prefix)) || decoratedKnowledge[0];
      keyword = (await contentAi.deriveKeyword({ language: execution.site.language, sourceType: execution.sourceType === ExecutionSourceType.REWRITE_URL ? 'REWRITE_URL' : execution.sourceType === ExecutionSourceType.COMPETITOR_URL ? 'COMPETITOR_URL' : 'SITE', title: primary.decoratedTitle, content: primary.content })).keyword;
    }
    if (!keyword) throw new Error('未能解析可验证的目标关键词');
    await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { resolvedKeyword: keyword } });
  }

  let opportunityId = execution.opportunityId;
  if (!opportunityId) {
    await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { stage: ExecutionStage.KEYWORD_RESEARCH } });
    const metrics = await dataForSeoProvider.scanKeyword({ keyword, languageCode: payload.languageCode, locationCode: payload.locationCode });
    opportunityId = await workerPrisma.$transaction(async (tx) => {
      const snapshot = await tx.dataSnapshot.create({ data: { organizationId: run.organizationId, siteId: execution!.siteId, source: DataSource.DATAFORSEO, status: DataStatus.LIVE, formulaVersion: 'seo-metrics-1', fetchedAt: new Date(metrics.fetchedAt), payload: metrics as Prisma.InputJsonValue } });
      const scan = await tx.keywordScan.create({ data: { organizationId: run.organizationId, siteId: execution!.siteId, snapshotId: snapshot.id, seedKeyword: keyword!, languageCode: payload.languageCode!, locationCode: payload.locationCode!, status: JobStatus.SUCCEEDED, resultCount: 1, completedAt: new Date() } });
      const volume = BigInt(Math.max(0, metrics.searchVolume));
      const roi = BigInt(Math.max(0, 100 - metrics.keywordDifficulty)) * volume * 1_000_000n / BigInt(metrics.allintitleCount + 1);
      const type = execution!.sourceType === ExecutionSourceType.COMPETITOR_URL ? 'COMPETITOR_GAP' : execution!.sourceType === ExecutionSourceType.REWRITE_URL ? 'CONTENT_GAP' : 'KGR';
      const opportunity = await tx.opportunity.create({ data: { organizationId: run.organizationId, siteId: execution!.siteId, keywordScanId: scan.id, snapshotId: snapshot.id, sourceKey: `execution:${execution!.id}`, type, title: keyword!, keyword, searchVolume: metrics.searchVolume, keywordDifficulty: metrics.keywordDifficulty, allintitleCount: metrics.allintitleCount, kgrNumerator: BigInt(metrics.allintitleCount), kgrDenominator: volume, roiScoreMicros: roi, formulaVersion: 'autonomous-execution-1', evidence: { source: 'DATAFORSEO', snapshotId: snapshot.id, executionRunId: execution!.id, inputType: execution!.sourceType } } });
      await tx.executionRun.update({ where: { id: execution!.id }, data: { opportunityId: opportunity.id } });
      return opportunity.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  execution = await workerPrisma.executionRun.findUniqueOrThrow({ where: { id: execution.id }, include: { site: true, automationTask: true } });
  if (execution.draftId) return execution.id;
  const opportunity = await workerPrisma.opportunity.findFirst({ where: { id: opportunityId, organizationId: run.organizationId }, include: { snapshot: true } });
  if (!opportunity?.keyword || opportunity.snapshot.status !== DataStatus.LIVE) throw new Error('真实 SEO 机会或快照不可用');
  await workerPrisma.executionRun.update({ where: { id: execution.id }, data: { stage: ExecutionStage.CONTENT_GENERATION } });
  const targetInventory = decoratedKnowledge.find(({ decoratedTitle }) => decoratedTitle.startsWith('[TARGET_SITE]'));
  const internalLinkCandidates = [...(targetInventory?.content.matchAll(/\[PAGE\]\nURL: (https:\/\/[^\n]+)\nTITLE: ([^\n]+)/g) || [])]
    .map((match) => ({ url: match[1], title: match[2].trim() }))
    .filter(({ url }) => {
      try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() === targetHost; } catch { return false; }
    });
  const generated = await contentAi.generate({
    keyword: opportunity.keyword,
    language: execution.site.language,
    seoSnapshot: opportunity.snapshot.payload,
    knowledge: decoratedKnowledge.map(({ decoratedTitle, content }) => ({ title: decoratedTitle, content })),
    internalLinks: selectRelevantInternalLinks(opportunity.keyword, opportunity.title, internalLinkCandidates)
  });

  await workerPrisma.$transaction(async (tx) => {
    const automatic = generated.qualityReport.passed
      && execution!.site.publishPolicy === PublishPolicy.AUTO_PUBLISH
      && execution!.site.wordpressStatus === SiteConnectionStatus.CONNECTED
      && Boolean(execution!.site.wordpressCredentials)
      && Boolean(execution!.site.wordpressVerifiedAt);
    const draft = await tx.contentDraft.create({ data: {
      organizationId: run.organizationId,
      siteId: execution!.siteId,
      opportunityId: opportunity.id,
      seoSnapshotId: opportunity.snapshot.id,
      status: automatic ? DraftStatus.PUBLISHING : generated.qualityReport.passed ? DraftStatus.PENDING_REVIEW : DraftStatus.QUALITY_FAILED,
      title: generated.title,
      slug: generated.slug,
      html: generated.html,
      qualityReport: generated.qualityReport as Prisma.InputJsonValue,
      dataProvenance: [{ snapshotId: opportunity.snapshot.id, source: opportunity.snapshot.source, status: opportunity.snapshot.status, fetchedAt: opportunity.snapshot.fetchedAt.toISOString(), formulaVersion: opportunity.snapshot.formulaVersion, executionRunId: execution!.id }] as Prisma.InputJsonValue,
      knowledgeSourceIds: sourceIds
    } });
    if (!generated.qualityReport.passed) {
      await billingService.releaseCreditHold(tx, runId);
      await tx.executionRun.update({ where: { id: execution!.id }, data: { draftId: draft.id, status: ExecutionStatus.FAILED, stage: ExecutionStage.QUALITY_GATE, errorCode: 'QUALITY_GATE_FAILED', errorMessage: '草稿未通过确定性质量门禁', finishedAt: new Date() } });
      if (execution!.automationTaskId) await tx.automationTask.updateMany({ where: { id: execution!.automationTaskId, status: 'ACTIVE' }, data: { status: 'PAUSED', lastError: '草稿未通过质量门禁' } });
      return;
    }
    await billingService.settleCreditHold(tx, runId, 'content_draft', draft.id);
    if (automatic) {
      const publish = await jobService.create(tx, { organizationId: run.organizationId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: `execution-publish:${execution!.id}`, payload: { draftId: draft.id, automated: true, executionRunId: execution!.id } });
      await tx.publishAttempt.create({ data: { organizationId: run.organizationId, draftId: draft.id, jobRunId: publish.id, attemptNumber: 1 } });
      await tx.executionRun.update({ where: { id: execution!.id }, data: { draftId: draft.id, status: ExecutionStatus.PUBLISHING, stage: ExecutionStage.PUBLISHING } });
    } else {
      await tx.executionRun.update({ where: { id: execution!.id }, data: { draftId: draft.id, status: ExecutionStatus.AWAITING_REVIEW, stage: ExecutionStage.QUALITY_GATE, result: { manualReviewRequired: true, reason: 'AUTO_PUBLISH_GATE_NOT_UNLOCKED' } } });
    }
    await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'AUTONOMOUS_DRAFT_CREATED', targetType: 'execution_run', targetId: execution!.id, metadata: { draftId: draft.id, automatic, sourceType: execution!.sourceType } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return execution.id;
};

const processContentGeneration = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { siteId?: string; opportunityId?: string; knowledgeSourceIds?: string[]; seoSnapshotId?: string; keyword?: string; automationTaskId?: string };
  if (!payload.siteId || !payload.opportunityId || !payload.seoSnapshotId || !payload.keyword || !payload.knowledgeSourceIds?.length) throw new Error('内容任务参数不完整');
  const [site, snapshot, knowledge] = await Promise.all([
    workerPrisma.site.findFirst({ where: { id: payload.siteId, organizationId: run.organizationId } }),
    workerPrisma.dataSnapshot.findFirst({ where: { id: payload.seoSnapshotId, organizationId: run.organizationId, status: DataStatus.LIVE } }),
    workerPrisma.knowledgeSource.findMany({ where: { id: { in: payload.knowledgeSourceIds }, organizationId: run.organizationId, status: DataStatus.LIVE } })
  ]);
  if (!site || !snapshot || knowledge.length !== payload.knowledgeSourceIds.length) throw new Error('真实快照或知识来源缺失，内容任务已失败关闭');
  const generated = await contentAi.generate({ keyword: payload.keyword, language: site.language, seoSnapshot: snapshot.payload, knowledge: knowledge.map(({ title, content }) => ({ title, content })) });
  return workerPrisma.$transaction(async (tx) => {
    const automatic = Boolean(payload.automationTaskId && generated.qualityReport.passed && site.publishPolicy === PublishPolicy.AUTO_PUBLISH && site.wordpressStatus === SiteConnectionStatus.CONNECTED && site.wordpressCredentials);
    const draft = await tx.contentDraft.create({ data: { organizationId: run.organizationId, siteId: site.id, opportunityId: payload.opportunityId, seoSnapshotId: snapshot.id, status: automatic ? DraftStatus.PUBLISHING : generated.qualityReport.passed ? DraftStatus.PENDING_REVIEW : DraftStatus.QUALITY_FAILED, title: generated.title, slug: generated.slug, html: generated.html, qualityReport: generated.qualityReport as Prisma.InputJsonValue, dataProvenance: [{ snapshotId: snapshot.id, source: snapshot.source, status: snapshot.status, fetchedAt: snapshot.fetchedAt.toISOString(), formulaVersion: snapshot.formulaVersion }] as Prisma.InputJsonValue, knowledgeSourceIds: payload.knowledgeSourceIds } });
    await billingService.settleCreditHold(tx, runId, 'content_draft', draft.id);
    if (payload.automationTaskId && !automatic) {
      await tx.automationTask.updateMany({ where: { id: payload.automationTaskId, organizationId: run.organizationId, status: 'ACTIVE' }, data: { status: 'PAUSED', lastError: '质量、连接、数据或自动发布策略门禁未通过' } });
      await tx.notification.create({ data: { organizationId: run.organizationId, type: 'AUTOMATION_PAUSED', title: '自动任务已暂停', message: '草稿未通过自动发布门禁，未发布内容。', metadata: { automationTaskId: payload.automationTaskId, draftId: draft.id } } });
    }
    if (automatic) {
      const publish = await jobService.create(tx, { organizationId: run.organizationId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: `automation-publish:${payload.automationTaskId}:${draft.id}`, payload: { draftId: draft.id, automated: true } });
      await tx.publishAttempt.create({ data: { organizationId: run.organizationId, draftId: draft.id, jobRunId: publish.id, attemptNumber: 1 } });
    }
    return draft.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const processWordPressPublish = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { draftId?: string; automated?: boolean; executionRunId?: string };
  if (!payload.draftId) throw new Error('发布任务缺少 draftId');
  const draft = await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: run.organizationId }, include: { site: true, reviews: true } });
  const approved = draft?.reviews.some(({ decision }) => decision === 'APPROVED');
  const allowedAutomatic = payload.automated === true && draft?.site.publishPolicy === PublishPolicy.AUTO_PUBLISH;
  if (!draft?.site.wordpressCredentials || draft.status !== DraftStatus.PUBLISHING || (!approved && !allowedAutomatic)) throw new Error('草稿、审批/自动发布门禁或 WordPress 凭证不可用');
  const published = await wordPressService.publish({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, title: draft.title, slug: draft.slug, html: draft.html });
  await workerPrisma.$transaction(async (tx) => {
    await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.PUBLISHED, remotePostId: published.postId, publishedUrl: published.url } });
    await tx.publishAttempt.updateMany({ where: { jobRunId: runId }, data: { status: PublishAttemptStatus.SUCCEEDED, remotePostId: published.postId, remoteUrl: published.url, finishedAt: new Date() } });
    await tx.site.update({ where: { id: draft.siteId }, data: { manualPublishSuccesses: { increment: draft.site.publishPolicy === PublishPolicy.MANUAL_REVIEW ? 1 : 0 } } });
    await tx.jobRun.create({ data: { organizationId: run.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `indexing:${draft.id}:1`, payload: { draftId: draft.id, observationNumber: 1 }, availableAt: new Date(Date.now() + 60 * 60_000) } });
    await tx.auditEvent.create({ data: { organizationId: run.organizationId, action: 'WORDPRESS_PUBLISHED', targetType: 'content_draft', targetId: draft.id, metadata: published } });
    await tx.executionRun.updateMany({ where: { organizationId: run.organizationId, draftId: draft.id }, data: { status: ExecutionStatus.MONITORING, stage: ExecutionStage.MONITORING, result: { publishedUrl: published.url, remotePostId: published.postId, indexingMonitoringScheduled: true }, finishedAt: null } });
  });
  return draft.id;
};

const processIndexingMonitor = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { draftId?: string; observationNumber?: number };
  const draft = payload.draftId ? await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: run.organizationId }, include: { site: true } }) : null;
  if (!draft?.publishedUrl) throw new Error('索引监测缺少已发布 URL');
  const origin = await resolvePublicHttpsOrigin(draft.site.domain);
  let sitemapStatus: DataStatus = DataStatus.UNAVAILABLE;
  let present = false;
  let statusCode: number | undefined;
  for (const path of ['/wp-sitemap.xml', '/sitemap.xml']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/xml,text/xml' } });
    statusCode = response.status;
    if (response.ok) {
      const xml = await response.text();
      present = xml.includes(draft.publishedUrl);
      sitemapStatus = DataStatus.LIVE;
      break;
    }
  }
  const observationNumber = Math.max(1, Number(payload.observationNumber) || 1);
  const observation = await workerPrisma.$transaction(async (tx) => {
    const created = await tx.indexingObservation.create({ data: { organizationId: run.organizationId, siteId: draft.siteId, draftId: draft.id, url: draft.publishedUrl!, source: 'SITEMAP', indexed: null, status: sitemapStatus, observedAt: new Date(), payload: { sitemapPresent: present, statusCode, note: 'Sitemap presence is not treated as proof of indexing' } } });
    if (observationNumber < 7) await tx.jobRun.create({ data: { organizationId: run.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `indexing:${draft.id}:${observationNumber + 1}`, payload: { draftId: draft.id, observationNumber: observationNumber + 1 }, availableAt: new Date(Date.now() + 24 * 60 * 60_000) } });
    const executions = await tx.executionRun.findMany({ where: { organizationId: run.organizationId, draftId: draft.id } });
    for (const execution of executions) {
      const previous = execution.result && typeof execution.result === 'object' && !Array.isArray(execution.result) ? execution.result as Record<string, unknown> : {};
      await tx.executionRun.update({ where: { id: execution.id }, data: {
        status: observationNumber >= 7 ? ExecutionStatus.SUCCEEDED : ExecutionStatus.MONITORING,
        stage: observationNumber >= 7 ? ExecutionStage.COMPLETED : ExecutionStage.MONITORING,
        result: { ...previous, lastIndexingObservationId: created.id, sitemapPresent: present, indexingObservationNumber: observationNumber, indexingComplete: observationNumber >= 7 },
        finishedAt: observationNumber >= 7 ? new Date() : null
      } });
    }
    return created;
  });
  return observation.id;
};

const processWordPressRollback = async (runId: string): Promise<string> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { draftId?: string };
  const draft = payload.draftId ? await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: run.organizationId }, include: { site: true } }) : null;
  if (!draft?.site.wordpressCredentials || !draft.remotePostId) throw new Error('没有可回滚的 WordPress 文章');
  await wordPressService.rollback({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, postId: draft.remotePostId });
  await workerPrisma.$transaction([workerPrisma.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.ROLLED_BACK } }), workerPrisma.publishAttempt.updateMany({ where: { draftId: draft.id, status: PublishAttemptStatus.SUCCEEDED }, data: { status: PublishAttemptStatus.ROLLED_BACK } }), workerPrisma.auditEvent.create({ data: { organizationId: run.organizationId, action: 'WORDPRESS_ROLLED_BACK', targetType: 'content_draft', targetId: draft.id } })]);
  return draft.id;
};

const processPayment = async (runId: string): Promise<{ deferred: boolean; resultId?: string }> => {
  const run = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const paymentIntentId = (run.payload as { paymentIntentId?: string }).paymentIntentId;
  if (!paymentIntentId) throw new Error('支付核验任务缺少 paymentIntentId');
  const payment = await workerPrisma.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId } });
  if (!payment.txHash) throw new Error('支付意图尚未提交交易哈希');
  if (payment.expiresAt <= new Date()) {
    await workerPrisma.paymentIntent.update({ where: { id: payment.id }, data: { status: PaymentStatus.EXPIRED } });
    throw new Error('支付意图已过期');
  }
  try {
    const verification = await tronGridProvider.verifyTransfer({ txHash: payment.txHash, recipientAddress: payment.recipientAddress, expectedAmountMicros: payment.expectedAmountMicros, notBefore: payment.createdAt, notAfter: payment.expiresAt });
    await workerPrisma.paymentIntent.update({ where: { id: payment.id }, data: { status: PaymentStatus.CONFIRMED, confirmedAt: new Date(), verification } });
    await billingService.creditConfirmedPayment(workerPrisma, payment.id, verification as Prisma.InputJsonValue);
    return { deferred: false, resultId: payment.id };
  } catch (error) {
    if (new Date(Date.now() + 30_000) < payment.expiresAt) {
      const bucket = Math.floor(Date.now() / 30_000);
      await getProductionQueue().add(JobType.PAYMENT_VERIFY, { jobRunId: runId }, productionJobOptions(`${runId}:verify:${bucket}`, { delay: 30_000 }));
      await workerPrisma.jobRun.update({ where: { id: runId }, data: { status: JobStatus.QUEUED, heartbeatAt: new Date(), errorCode: 'PAYMENT_PENDING', errorMessage: error instanceof Error ? error.message : String(error) } });
      return { deferred: true };
    }
    throw error;
  }
};

export const createProductionWorker = () => new Worker<QueuePayload>(PRODUCTION_QUEUE, async (queueJob: Job<QueuePayload>) => {
  if (queueJob.data.system || queueJob.name === JobType.AUTOMATION_RECONCILE) {
    await reconcile();
    return;
  }
  const runId = queueJob.data.jobRunId;
  if (!runId) throw new Error('队列任务缺少 jobRunId');
  const run = await workerPrisma.jobRun.update({ where: { id: runId }, data: { status: JobStatus.RUNNING, attempts: { increment: 1 }, startedAt: new Date(), heartbeatAt: new Date(), errorCode: null, errorMessage: null } });
  try {
    let resultId: string | undefined;
    let deferred = false;
    switch (run.type) {
      case JobType.AUTONOMOUS_EXECUTION: resultId = await processAutonomousExecution(runId); break;
      case JobType.DATAFORSEO_KEYWORD_SCAN: resultId = await processKeywordScan(runId); break;
      case JobType.CONTENT_GENERATION: resultId = await processContentGeneration(runId); break;
      case JobType.GROWTH_CYCLE: resultId = await processGrowthCycle(runId); break;
      case JobType.GROWTH_ACTION_EXECUTE: resultId = await processGrowthAction(runId); break;
      case JobType.GROWTH_MEASURE: throw new Error('没有到期且具备充分数据的观察动作');
      case JobType.WORDPRESS_PUBLISH: resultId = await processWordPressPublish(runId); break;
      case JobType.WORDPRESS_ROLLBACK: resultId = await processWordPressRollback(runId); break;
      case JobType.INDEXING_MONITOR: resultId = await processIndexingMonitor(runId); break;
      case JobType.PAYMENT_VERIFY: ({ resultId, deferred } = await processPayment(runId)); break;
      case JobType.GSC_SYNC: {
        const payload = run.payload as { connectionId?: string; siteId?: string; growthBaseline?: boolean; growthRefresh?: boolean; startDate?: string; endDate?: string };
        const connection = payload.connectionId ? await workerPrisma.integrationConnection.findUnique({ where: { id: payload.connectionId } }) : null;
        if (!connection?.propertyId || !payload.startDate || !payload.endDate) throw new Error('GSC 同步参数不完整');
        const credentials = decryptSecret<{ refreshToken: string }>(Buffer.from(connection.encryptedCredentials));
        const comparisonWindow = gscComparisonWindow(payload.startDate, payload.endDate);
        if (!comparisonWindow || comparisonWindow.periodDays < 7 || comparisonWindow.periodDays > 90) throw new Error('GSC 同步窗口必须为 7 到 90 天');
        const [currentResult, previousResult] = await Promise.all([
          gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, startDate: payload.startDate, endDate: payload.endDate }),
          gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, startDate: comparisonWindow.previous.startDate, endDate: comparisonWindow.previous.endDate })
        ]);
        const snapshot = await workerPrisma.$transaction(async (tx) => {
          const previous = await tx.dataSnapshot.create({ data: {
            organizationId: connection.organizationId, siteId: connection.siteId, source: DataSource.GSC, status: DataStatus.LIVE,
            fetchedAt: new Date(), availableFrom: new Date(`${comparisonWindow.previous.endDate}T00:00:00Z`),
            periodStart: new Date(`${comparisonWindow.previous.startDate}T00:00:00Z`), periodEnd: new Date(`${comparisonWindow.previous.endDate}T00:00:00Z`),
            payload: { period: comparisonWindow.previous, rows: previousResult.rows || [] }
          } });
          const current = await tx.dataSnapshot.create({ data: {
            organizationId: connection.organizationId, siteId: connection.siteId, source: DataSource.GSC, status: DataStatus.LIVE,
            fetchedAt: new Date(), availableFrom: new Date(`${comparisonWindow.current.endDate}T00:00:00Z`),
            periodStart: new Date(`${comparisonWindow.current.startDate}T00:00:00Z`), periodEnd: new Date(`${comparisonWindow.current.endDate}T00:00:00Z`),
            comparisonSnapshotId: previous.id,
            payload: { period: comparisonWindow.current, comparisonSnapshotId: previous.id, rows: currentResult.rows || [] }
          } });
          await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: 'CONNECTED', lastSyncedAt: new Date(), lastErrorCode: null, lastErrorMessage: null } });
          return current;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const growthState = await workerPrisma.siteGrowthState.findUnique({ where: { siteId: connection.siteId } });
        if (payload.growthBaseline || payload.growthRefresh || growthState?.status === GrowthStateStatus.BASELINING) {
          await workerPrisma.$transaction(async (tx) => {
            await growthService.createCycle(tx, { organizationId: connection.organizationId, siteId: connection.siteId, trigger: GrowthCycleTrigger.DATA_CHANGE, idempotencyKey: `growth:${connection.siteId}:${snapshot.id}`, inputWatermark: snapshot.fetchedAt });
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } else if (growthState && growthState.status !== GrowthStateStatus.PAUSED && (!growthState.lastDataWatermark || snapshot.fetchedAt > growthState.lastDataWatermark)) {
          await workerPrisma.siteGrowthState.update({ where: { id: growthState.id }, data: { nextDecisionAt: new Date() } });
        }
        resultId = snapshot.id;
        break;
      }
      default: throw new Error(`Worker 不支持作业类型 ${run.type}`);
    }
    if (!deferred) await workerPrisma.jobRun.update({ where: { id: runId }, data: { status: JobStatus.SUCCEEDED, result: resultId ? { resultId } : undefined, finishedAt: new Date(), heartbeatAt: new Date() } });
  } catch (error) {
    await markFailed(runId, error);
    throw error;
  }
}, { connection: getQueueConnection(), concurrency: Number(process.env.WORKER_CONCURRENCY || 5), lockDuration: 120_000 });

export const startProductionWorker = async (): Promise<void> => {
  assertProductionConfiguration('worker');
  productionConfigurationWarnings('worker').forEach((warning) => logger.warn('CONFIGURATION', warning));
  await assertDatabaseSecurity(workerPrisma, 'app_worker');
  const queue = getProductionQueue();
  await queue.upsertJobScheduler('database-reconciliation', { every: 10_000 }, { name: JobType.AUTOMATION_RECONCILE, data: { system: true }, opts: { removeOnComplete: 10, removeOnFail: 100 } });
  await reconcile();
  const worker = createProductionWorker();
  worker.on('completed', (job) => logger.info('WORKER', `Job ${job.id} completed`));
  worker.on('failed', (job, error) => { logger.error('WORKER', `Job ${job?.id} failed: ${error.message}`); Sentry.captureException(error, { tags: { queue: PRODUCTION_QUEUE, jobId: String(job?.id || '') } }); });
  const shutdown = async (): Promise<void> => { await worker.close(); await closeQueue(); await disconnectWorkerDatabase(); process.exit(0); };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
};

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.cjs')) void startProductionWorker().catch((error) => { logger.error('WORKER_BOOT', 'Worker failed to start', { data: error }); process.exit(1); });
