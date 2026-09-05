import { randomUUID } from 'crypto';
import {
  DataSource,
  DataStatus,
  DraftStatus,
  GrowthActionStatus,
  GrowthActionType,
  GrowthAutonomyDecision,
  GrowthProgramMode,
  GrowthProgramStatus,
  GrowthRunStageCode,
  GrowthRunStageStatus,
  GrowthRunStatus,
  JobStatus,
  JobType,
  PaymentStatus,
  Prisma,
  PublishAttemptStatus,
  SiteConnectionStatus
} from '@prisma/client';
import { Job, Worker } from 'bullmq';
import * as Sentry from '@sentry/node';
import { billingService } from './billingService';
import { contentAi } from './contentAi';
import { decryptSecret } from './crypto';
import { env, assertProductionConfiguration, productionConfigurationStatus, productionConfigurationWarnings } from './env';
import { gscComparisonWindow, readGscRows } from './growthEngine';
import { continuousCadenceDays, qualifySearchOpportunity, selectGrowthAction } from './growthPolicy';
import { growthProgramService } from './growthProgramService';
import { jobService } from './jobService';
import { dataForSeoProvider, gscProvider, tronGridProvider } from './providers';
import { closeQueue, getProductionQueue, getQueueConnection, PRODUCTION_QUEUE, productionJobOptions } from './queue';
import { capturePublicSource, type CapturedSource } from './sourceFetcher';
import { assessSourceOriginality, deterministicActionQualityGate, selectRelevantInternalLinks } from './seoPipeline';
import { resolveSeoMarket } from './seoMarket';
import { wordPressService, type WordPressEditableSnapshot, type WordPressSiteContext } from './wordpress';
import { disconnectWorkerDatabase, workerPrisma } from './workerPrisma';
import { assertDatabaseSecurity } from './databaseSecurity';
import { logger } from '../utils/logger';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { ValidationError } from '../domain/errors';
import { parsePublishingConfirmationPolicy, PUBLISH_CONFIRMATION_SETTING_KEY } from './publishingPolicy';

type QueuePayload = { jobRunId?: string; system?: boolean };
type Evidence = Array<Record<string, unknown>>;

const workerId = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID().slice(0, 8)}`;
const startedAt = new Date();
const day = 86_400_000;
const escapeMarkup = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const requiresManualConfirmation = async (): Promise<boolean> => {
  const setting = await workerPrisma.systemSetting.findUnique({ where: { key: PUBLISH_CONFIRMATION_SETTING_KEY } });
  return parsePublishingConfirmationPolicy(setting?.value).requireManualConfirmation;
};

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    sendDefaultPii: false
  });
}

const completeStage = async (tx: Prisma.TransactionClient, input: {
  runId: string;
  stage: GrowthRunStageCode;
  summary: string;
  evidence?: Evidence;
  processedCount?: number;
  totalCount?: number;
}) => {
  const existing = await tx.growthRunStage.findUniqueOrThrow({ where: { runId_stage: { runId: input.runId, stage: input.stage } } });
  const now = new Date();
  await tx.growthRunStage.update({
    where: { runId_stage: { runId: input.runId, stage: input.stage } },
    data: {
      status: GrowthRunStageStatus.COMPLETED,
      summary: input.summary,
      evidence: (input.evidence || []) as Prisma.InputJsonValue,
      processedCount: input.processedCount || 0,
      totalCount: input.totalCount,
      startedAt: existing.startedAt || now,
      finishedAt: now,
      errorCode: null,
      errorMessage: null
    }
  });
};

const startStage = async (runId: string, stage: GrowthRunStageCode): Promise<void> => {
  await workerPrisma.$transaction(async (tx) => {
    const [run, stageRow] = await Promise.all([
      tx.growthRun.findUniqueOrThrow({ where: { id: runId } }),
      tx.growthRunStage.findUniqueOrThrow({ where: { runId_stage: { runId, stage } } })
    ]);
    const now = new Date();
    await tx.growthRun.update({ where: { id: runId }, data: { status: GrowthRunStatus.RUNNING, currentStage: stage, startedAt: run.startedAt || now, errorCode: null, errorMessage: null } });
    await tx.growthRunStage.update({ where: { runId_stage: { runId, stage } }, data: { status: GrowthRunStageStatus.RUNNING, startedAt: stageRow.startedAt || now, finishedAt: null, errorCode: null, errorMessage: null } });
  });
};

const persistSource = async (tx: Prisma.TransactionClient, input: {
  organizationId: string;
  siteId: string;
  prefix: '[TARGET_SITE]' | '[REFERENCE]' | '[COMPETITOR]';
  source: Pick<CapturedSource, 'normalizedUrl' | 'title' | 'content' | 'checksum' | 'fetchedAt'>;
}): Promise<string> => {
  const existing = await tx.knowledgeSource.findUnique({ where: { organizationId_checksum: { organizationId: input.organizationId, checksum: input.source.checksum } } });
  if (existing) return existing.id;
  const created = await tx.knowledgeSource.create({ data: {
    organizationId: input.organizationId,
    siteId: input.siteId,
    type: 'ALLOWLISTED_URL',
    title: `${input.prefix} ${input.source.title}`.slice(0, 200),
    sourceUrl: input.source.normalizedUrl,
    normalizedUrl: input.source.normalizedUrl,
    content: input.source.content,
    summary: input.source.content.slice(0, 500),
    checksum: input.source.checksum,
    fetchedAt: new Date(input.source.fetchedAt)
  } });
  return created.id;
};

const targetPageFromContext = (keyword: string, context: WordPressSiteContext): { title: string; url: string } | undefined => {
  const normalizedKeyword = keyword.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = normalizedKeyword.match(/[\p{L}\p{N}]{2,}/gu) || [];
  return context.internalLinks.find(({ title }) => {
    const normalizedTitle = title.toLocaleLowerCase();
    if (normalizedTitle.includes(normalizedKeyword)) return true;
    return tokens.length > 0 && tokens.filter((token) => normalizedTitle.includes(token)).length / tokens.length >= 0.8;
  });
};

const processGrowthRun = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const growthRunId = (job.payload as { growthRunId?: string }).growthRunId;
  if (!growthRunId) throw new Error('增长任务缺少 growthRunId');
  let run = await workerPrisma.growthRun.findFirst({
    where: { id: growthRunId, organizationId: job.organizationId },
    include: { program: true, site: true, actions: true }
  });
  if (!run) throw new Error('增长执行不存在');
  if (run.status === GrowthRunStatus.DELIVERED || run.status === GrowthRunStatus.CANCELLED) return run.id;
  if (run.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !run.site.wordpressCredentials || !run.site.wordpressVerifiedAt) {
    throw new ValidationError('WordPress 连接未通过验证，无法执行真实站点分析');
  }

  await startStage(run.id, GrowthRunStageCode.UNDERSTAND);
  const [health, targetContext] = await Promise.all([
    wordPressService.inspectSiteHealth(run.site.domain),
    wordPressService.readSiteContext(run.site.domain, run.site.wordpressCredentials).catch(async (error): Promise<WordPressSiteContext> => {
      if (!(error instanceof ValidationError) || !error.message.includes('没有足够')) throw error;
      const source = await capturePublicSource(run!.site.domain);
      return { ...source, internalLinks: [] };
    })
  ]);
  let externalSource: CapturedSource | undefined;
  if (run.program.inputType !== 'KEYWORD') externalSource = await capturePublicSource(run.program.inputValue);
  const sourceIds = await workerPrisma.$transaction(async (tx) => {
    const ids = [await persistSource(tx, { organizationId: run!.organizationId, siteId: run!.siteId, prefix: '[TARGET_SITE]', source: targetContext })];
    if (externalSource) {
      ids.push(await persistSource(tx, {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        prefix: run!.program.inputType === 'REFERENCE_URL' ? '[REFERENCE]' : '[COMPETITOR]',
        source: externalSource
      }));
    }
    await tx.growthRun.update({ where: { id: run!.id }, data: { knowledgeSourceIds: ids } });
    await completeStage(tx, {
      runId: run!.id,
      stage: GrowthRunStageCode.UNDERSTAND,
      summary: `已验证 WordPress、HTTPS 与站点结构，自动读取 ${targetContext.internalLinks.length} 个站内页面。`,
      processedCount: targetContext.internalLinks.length,
      totalCount: targetContext.internalLinks.length,
      evidence: [{ type: 'SITE_HEALTH', ...health }, { type: 'SITE_CORPUS', sourceId: ids[0], checksum: targetContext.checksum }, ...(externalSource ? [{ type: run!.program.inputType, sourceId: ids[1], checksum: externalSource.checksum }] : [])]
    });
    return ids;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await startStage(run.id, GrowthRunStageCode.DISCOVER);
  let keyword = run.resolvedKeyword;
  if (!keyword) {
    if (run.program.inputType === 'KEYWORD') keyword = run.program.inputValue.trim();
    else if (externalSource) {
      keyword = (await contentAi.deriveKeyword({
        language: run.site.language,
        sourceType: run.program.inputType === 'REFERENCE_URL' ? 'REFERENCE_URL' : 'COMPETITOR_SITE',
        title: externalSource.title,
        content: externalSource.content
      })).keyword;
    }
  }
  if (!keyword) throw new Error('无法从用户线索中解析出可验证的目标关键词');
  let opportunity = run.opportunityId ? await workerPrisma.opportunity.findUnique({ where: { id: run.opportunityId }, include: { snapshot: true } }) : null;
  const cannibalized = targetPageFromContext(keyword, targetContext);
  const relevantInternalLinks = selectRelevantInternalLinks(keyword, cannibalized?.title || keyword, targetContext.internalLinks.filter(({ url }) => url !== cannibalized?.url));
  const targetSnapshot = cannibalized
    ? await wordPressService.inspectTarget({ domain: run.site.domain, encrypted: run.site.wordpressCredentials, targetUrl: cannibalized.url })
    : undefined;
  if (!opportunity) {
    const market = resolveSeoMarket({ domain: run.site.domain, language: run.site.language, defaultLocationCode: env.defaultSeoLocationCode });
    const metrics = await dataForSeoProvider.scanKeyword({ keyword, languageCode: market.languageCode, locationCode: market.locationCode });
    opportunity = await workerPrisma.$transaction(async (tx) => {
      const snapshot = await tx.dataSnapshot.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        source: DataSource.DATAFORSEO,
        status: DataStatus.LIVE,
        formulaVersion: 'seo-metrics-2',
        fetchedAt: new Date(metrics.fetchedAt),
        payload: metrics as Prisma.InputJsonValue
      } });
      const scan = await tx.keywordScan.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        snapshotId: snapshot.id,
        seedKeyword: keyword!,
        languageCode: market.languageCode,
        locationCode: market.locationCode,
        status: JobStatus.SUCCEEDED,
        resultCount: 0,
        completedAt: new Date()
      } });
      const qualification = qualifySearchOpportunity({
        searchVolume: metrics.searchVolume,
        keywordDifficulty: metrics.keywordDifficulty,
        allintitleCount: metrics.allintitleCount,
        hasSerpEvidence: metrics.serpEvidenceCount > 0
      });
      if (!qualification.qualified) {
        await billingService.releaseCreditHold(tx, jobRunId);
        await completeStage(tx, {
          runId: run!.id,
          stage: GrowthRunStageCode.DISCOVER,
          summary: `真实数据已采集，但本轮没有合格机会：${qualification.reason}。不执行、不扣费。`,
          processedCount: 1,
          totalCount: 1,
          evidence: [{ type: 'DATAFORSEO_SNAPSHOT', snapshotId: snapshot.id, fetchedAt: metrics.fetchedAt, qualified: false, reason: qualification.reason }]
        });
        await tx.growthRunStage.updateMany({ where: { runId: run!.id, stage: { in: [GrowthRunStageCode.DECIDE, GrowthRunStageCode.EXECUTE, GrowthRunStageCode.LEARN] } }, data: { status: GrowthRunStageStatus.SKIPPED, summary: '没有合格机会，本阶段未执行。', processedCount: 0, totalCount: 0, finishedAt: new Date() } });
        await tx.growthRun.update({ where: { id: run!.id }, data: { resolvedKeyword: keyword, status: GrowthRunStatus.BLOCKED, errorCode: 'NO_QUALIFIED_OPPORTUNITY', errorMessage: qualification.reason, finishedAt: new Date(), delivery: { skipped: true, charged: false, reason: qualification.reason, snapshotId: snapshot.id } } });
        await tx.growthProgram.update({ where: { id: run!.programId }, data: { status: run!.program.mode === GrowthProgramMode.ONCE ? GrowthProgramStatus.COMPLETED : GrowthProgramStatus.ACTIVE, lastRunAt: new Date(), lastError: null } });
        await tx.auditEvent.create({ data: { organizationId: run!.organizationId, action: 'GROWTH_RUN_SKIPPED', targetType: 'growth_run', targetId: run!.id, metadata: { reason: qualification.reason, charged: false, snapshotId: snapshot.id } } });
        return null;
      }
      await tx.keywordScan.update({ where: { id: scan.id }, data: { resultCount: 1 } });
      const volume = BigInt(Math.max(0, metrics.searchVolume));
      const roi = BigInt(Math.max(0, 100 - metrics.keywordDifficulty)) * volume * 1_000_000n / BigInt(metrics.allintitleCount + 1);
      const created = await tx.opportunity.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        keywordScanId: scan.id,
        snapshotId: snapshot.id,
        sourceKey: `growth-run:${run!.id}`,
        type: cannibalized ? 'EXISTING_PAGE' : run!.program.inputType === 'COMPETITOR_SITE' ? 'COMPETITOR_GAP' : run!.program.inputType === 'REFERENCE_URL' ? 'CONTENT_GAP' : 'KGR',
        title: keyword!,
        targetUrl: cannibalized?.url,
        keyword,
        searchVolume: metrics.searchVolume,
        keywordDifficulty: metrics.keywordDifficulty,
        allintitleCount: metrics.allintitleCount,
        kgrNumerator: BigInt(metrics.allintitleCount),
        kgrDenominator: volume,
        roiScoreMicros: roi,
        expectedValueMicros: roi,
        formulaVersion: 'growth-opportunity-2',
        evidence: { source: 'DATAFORSEO', snapshotId: snapshot.id, inputType: run!.program.inputType, market, cannibalizationTarget: cannibalized || null }
      }, include: { snapshot: true } });
      await tx.growthRun.update({ where: { id: run!.id }, data: { resolvedKeyword: keyword, opportunityId: created.id, targetUrl: cannibalized?.url } });
      await completeStage(tx, {
        runId: run!.id,
        stage: GrowthRunStageCode.DISCOVER,
        summary: cannibalized ? `发现站内已有同主题页面，避免新建页面造成关键词蚕食。` : `已取得真实搜索量、竞争度、SERP 与 allintitle 数据。`,
        processedCount: 1,
        totalCount: 1,
        evidence: [{ type: 'DATAFORSEO_SNAPSHOT', snapshotId: snapshot.id, fetchedAt: metrics.fetchedAt, market }, ...(cannibalized ? [{ type: 'CANNIBALIZATION', ...cannibalized }] : [])]
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!opportunity) return run.id;
  }

  await startStage(run.id, GrowthRunStageCode.DECIDE);
  let action = await workerPrisma.growthAction.findFirst({ where: { runId: run.id } });
  if (!action) {
    const gscSnapshot = await workerPrisma.dataSnapshot.findFirst({ where: { organizationId: run.organizationId, siteId: run.siteId, source: DataSource.GSC, status: DataStatus.LIVE }, orderBy: { fetchedAt: 'desc' } });
    const selection = selectGrowthAction({
      robotsBlocksAll: health.robots.blocksAll,
      target: targetSnapshot ? { contentLength: targetSnapshot.contentLength, modifiedAt: targetSnapshot.modifiedAt } : undefined,
      targetUrl: cannibalized?.url,
      gscRows: readGscRows(gscSnapshot?.payload),
      relevantInternalLinkCount: relevantInternalLinks.length
    });
    const actionType = selection.type;
    if (cannibalized) {
      const conflicting = await workerPrisma.growthAction.findFirst({ where: {
        siteId: run.siteId,
        targetUrl: cannibalized.url,
        runId: { not: run.id },
        OR: [{ status: { in: [GrowthActionStatus.EXECUTING, GrowthActionStatus.VERIFYING, GrowthActionStatus.OBSERVING] } }, { cooldownUntil: { gt: new Date() } }]
      } });
      if (conflicting) {
        await workerPrisma.$transaction(async (tx) => {
          await billingService.releaseCreditHold(tx, jobRunId);
          await tx.growthRunStage.update({ where: { runId_stage: { runId: run!.id, stage: GrowthRunStageCode.DECIDE } }, data: { status: GrowthRunStageStatus.BLOCKED, summary: '同一 URL 仍处于观察或冷却期，本轮不执行也不扣费。', errorCode: 'TARGET_COOLDOWN_ACTIVE', finishedAt: new Date() } });
          await tx.growthRun.update({ where: { id: run!.id }, data: { status: GrowthRunStatus.BLOCKED, errorCode: 'TARGET_COOLDOWN_ACTIVE', errorMessage: '同一 URL 仍处于观察或冷却期', finishedAt: new Date() } });
        });
        return run.id;
      }
    }
    const canAutoPublish = !await requiresManualConfirmation();
    action = await workerPrisma.$transaction(async (tx) => {
      const decision = await tx.growthDecision.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        runId: run!.id,
        opportunityId: opportunity!.id,
        status: 'SELECTED',
        rank: 1,
        scoreMicros: opportunity!.roiScoreMicros || 0n,
        scoreVersion: 'growth-decision-3',
        rationale: { selectedBecause: selection.reason, inputType: run!.program.inputType, gscSnapshotId: gscSnapshot?.id || null },
        selectedActionType: actionType
      } });
      const created = await tx.growthAction.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        runId: run!.id,
        decisionId: decision.id,
        opportunityId: opportunity!.id,
        type: actionType,
        status: GrowthActionStatus.PLANNED,
        riskLevel: selection.riskLevel,
        autonomyDecision: actionType === GrowthActionType.DIAGNOSE_ONLY || canAutoPublish ? GrowthAutonomyDecision.AUTO_EXECUTE : GrowthAutonomyDecision.REQUIRE_REVIEW,
        targetUrl: cannibalized?.url,
        reversible: true,
        expectedValueMicros: opportunity!.roiScoreMicros,
        plan: { action: actionType, keyword, targetUrl: cannibalized?.url || null, source: 'DETERMINISTIC_POLICY_V3', selectedBecause: selection.reason, mutatesWordPress: selection.mutatesWordPress, observationWindowsDays: [14, 28, 56] },
        cooldownUntil: cannibalized ? new Date(Date.now() + 56 * day) : undefined
      } });
      await tx.growthRun.update({ where: { id: run!.id }, data: { selectedActionType: actionType, targetUrl: cannibalized?.url } });
      await completeStage(tx, {
        runId: run!.id,
        stage: GrowthRunStageCode.DECIDE,
        summary: `已选择最小有效动作：${actionType}。${selection.reason}`,
        processedCount: 1,
        totalCount: 1,
        evidence: [{ type: 'ACTION_DECISION', actionId: created.id, action: actionType, autonomy: created.autonomyDecision, reversible: true }]
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  if (action.type === GrowthActionType.DIAGNOSE_ONLY) {
    await workerPrisma.$transaction(async (tx) => {
      const reason = String((action!.plan as { selectedBecause?: string }).selectedBecause || '技术门禁阻止内容动作');
      await billingService.releaseCreditHold(tx, jobRunId);
      await tx.growthAction.update({ where: { id: action!.id }, data: { status: GrowthActionStatus.SUCCEEDED, verifiedAt: new Date(), afterSnapshot: { diagnosis: reason, changedWordPress: false } } });
      await tx.growthRunStage.updateMany({ where: { runId: run!.id, stage: { in: [GrowthRunStageCode.EXECUTE, GrowthRunStageCode.LEARN] } }, data: { status: GrowthRunStageStatus.SKIPPED, summary: reason, processedCount: 0, totalCount: 0, finishedAt: new Date() } });
      await tx.growthRun.update({ where: { id: run!.id }, data: { status: GrowthRunStatus.DELIVERED, deliveredAt: new Date(), finishedAt: new Date(), delivery: { diagnosis: reason, changedWordPress: false, charged: false, actionId: action!.id } } });
      await tx.growthProgram.update({ where: { id: run!.programId }, data: { status: run!.program.mode === GrowthProgramMode.ONCE ? GrowthProgramStatus.COMPLETED : GrowthProgramStatus.ACTIVE, lastRunAt: new Date(), lastError: null } });
      await tx.auditEvent.create({ data: { organizationId: run!.organizationId, action: 'GROWTH_DIAGNOSIS_DELIVERED', targetType: 'growth_action', targetId: action!.id, metadata: { reason, charged: false, changedWordPress: false } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return run.id;
  }

  await startStage(run.id, GrowthRunStageCode.EXECUTE);
  if (run.draftId) return run.id;
  const knowledge = await workerPrisma.knowledgeSource.findMany({ where: { id: { in: sourceIds }, organizationId: run.organizationId, status: DataStatus.LIVE } });
  if (knowledge.length !== sourceIds.length) throw new Error('自动站点语料未完整持久化');
  const beforeSnapshot: WordPressEditableSnapshot | undefined = action.type === GrowthActionType.CREATE_CONTENT ? undefined : targetSnapshot;
  if (action.type !== GrowthActionType.CREATE_CONTENT && !beforeSnapshot) throw new Error('更新动作缺少可恢复的 WordPress 原始版本');
  const knowledgeInput = knowledge.map(({ title, content }) => ({ title, content }));
  let generated: { title: string; slug: string; html: string; qualityReport: ReturnType<typeof deterministicActionQualityGate> & Record<string, unknown> };
  if (action.type === GrowthActionType.UPDATE_TITLE) {
    const optimized = await contentAi.optimizeTitle({ keyword, language: run.site.language, currentTitle: beforeSnapshot!.title, pageText: beforeSnapshot!.content, seoSnapshot: opportunity.snapshot.payload });
    generated = {
      title: optimized.title,
      slug: beforeSnapshot!.slug,
      html: beforeSnapshot!.content,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'UPDATE_TITLE', title: optimized.title, html: beforeSnapshot!.content, beforeHtml: beforeSnapshot!.content }), rationale: optimized.rationale }
    };
  } else if (action.type === GrowthActionType.ADD_INTERNAL_LINKS) {
    const section = `<section class="aiseo-internal-links"><h2>相关阅读</h2><ul>${relevantInternalLinks.map(({ title, url }) => `<li><a href="${escapeMarkup(url)}" rel="noopener">${escapeMarkup(title)}</a></li>`).join('')}</ul></section>`;
    const html = `${beforeSnapshot!.content}${section}`;
    generated = {
      title: beforeSnapshot!.title,
      slug: beforeSnapshot!.slug,
      html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'ADD_INTERNAL_LINKS', title: beforeSnapshot!.title, html, beforeHtml: beforeSnapshot!.content, insertedInternalLinks: relevantInternalLinks.length }), internalLinks: { inserted: relevantInternalLinks.length, items: relevantInternalLinks } }
    };
  } else if (action.type === GrowthActionType.ADD_CONTENT_SECTION) {
    const section = await contentAi.generateSection({ keyword, language: run.site.language, currentTitle: beforeSnapshot!.title, currentHtml: beforeSnapshot!.content, seoSnapshot: opportunity.snapshot.payload, knowledge: knowledgeInput });
    const html = `${beforeSnapshot!.content}${section.html}`;
    const originality = externalSource ? assessSourceOriginality(section.html, externalSource.content) : undefined;
    generated = {
      title: beforeSnapshot!.title,
      slug: beforeSnapshot!.slug,
      html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'ADD_CONTENT_SECTION', title: beforeSnapshot!.title, html, beforeHtml: beforeSnapshot!.content, originality }), addedSection: section.heading }
    };
  } else {
    const article = await contentAi.generate({
      keyword,
      language: run.site.language,
      seoSnapshot: opportunity.snapshot.payload,
      knowledge: knowledgeInput,
      internalLinks: relevantInternalLinks
    });
    const originality = externalSource ? assessSourceOriginality(article.html, externalSource.content) : undefined;
    generated = {
      title: article.title,
      slug: article.slug,
      html: article.html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: action.type === GrowthActionType.CREATE_CONTENT ? 'CREATE_CONTENT' : 'CONTENT_REFRESH', title: article.title, html: article.html, originality }), internalLinks: article.qualityReport.internalLinks }
    };
  }
  await workerPrisma.$transaction(async (tx) => {
    // Read the global policy again immediately before creating the delivery so a
    // platform administrator can safely turn review on while a run is active.
    const publishingSetting = await tx.systemSetting.findUnique({ where: { key: PUBLISH_CONFIRMATION_SETTING_KEY } });
    const automatic = generated.qualityReport.passed
      && !parsePublishingConfirmationPolicy(publishingSetting?.value).requireManualConfirmation;
    const draft = await tx.contentDraft.create({ data: {
      organizationId: run!.organizationId,
      siteId: run!.siteId,
      opportunityId: opportunity!.id,
      seoSnapshotId: opportunity!.snapshot.id,
      status: generated.qualityReport.passed ? automatic ? DraftStatus.PUBLISHING : DraftStatus.PENDING_REVIEW : DraftStatus.QUALITY_FAILED,
      title: generated.title,
      slug: beforeSnapshot?.slug || generated.slug,
      html: generated.html,
      qualityReport: generated.qualityReport as Prisma.InputJsonValue,
      dataProvenance: [{ snapshotId: opportunity!.snapshot.id, source: 'DATAFORSEO', status: 'LIVE', fetchedAt: opportunity!.snapshot.fetchedAt.toISOString(), growthRunId: run!.id }] as Prisma.InputJsonValue,
      knowledgeSourceIds: sourceIds
    } });
    await tx.growthAction.update({ where: { id: action!.id }, data: {
      status: generated.qualityReport.passed ? automatic ? GrowthActionStatus.EXECUTING : GrowthActionStatus.REVIEW_REQUIRED : GrowthActionStatus.FAILED,
      beforeSnapshot: beforeSnapshot as unknown as Prisma.InputJsonValue | undefined
    } });
    if (!generated.qualityReport.passed) {
      await billingService.releaseCreditHold(tx, jobRunId);
      await tx.growthRunStage.update({ where: { runId_stage: { runId: run!.id, stage: GrowthRunStageCode.EXECUTE } }, data: { status: GrowthRunStageStatus.FAILED, summary: '草稿未通过确定性质量门禁，未写入 WordPress 且未扣费。', errorCode: 'QUALITY_GATE_FAILED', evidence: [generated.qualityReport] as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
      await tx.growthRun.update({ where: { id: run!.id }, data: { draftId: draft.id, status: GrowthRunStatus.FAILED, errorCode: 'QUALITY_GATE_FAILED', errorMessage: '草稿未通过确定性质量门禁', finishedAt: new Date() } });
      return;
    }
    await billingService.settleCreditHold(tx, jobRunId, 'content_draft', draft.id);
    await tx.growthRun.update({ where: { id: run!.id }, data: {
      draftId: draft.id,
      status: automatic ? GrowthRunStatus.RUNNING : GrowthRunStatus.NEEDS_REVIEW,
      delivery: { draftId: draft.id, actionId: action!.id, manualReviewRequired: !automatic, qualityScore: generated.qualityReport.score }
    } });
    await completeStage(tx, {
      runId: run!.id,
      stage: GrowthRunStageCode.EXECUTE,
      summary: automatic ? '内容通过质量门禁，已进入 WordPress 发布队列。' : '内容通过质量门禁，等待客户批准后写入 WordPress。',
      processedCount: 1,
      totalCount: 1,
      evidence: [{ type: 'CONTENT_DRAFT', draftId: draft.id, qualityScore: generated.qualityReport.score, actionId: action!.id, automatic }]
    });
    if (automatic) {
      const publish = await jobService.create(tx, { organizationId: run!.organizationId, type: JobType.WORDPRESS_PUBLISH, idempotencyKey: `growth-action-publish:${action!.id}`, payload: { draftId: draft.id, growthRunId: run!.id, actionId: action!.id, automated: true } });
      await tx.publishAttempt.create({ data: { organizationId: run!.organizationId, draftId: draft.id, jobRunId: publish.id, attemptNumber: 1 } });
    }
    await tx.auditEvent.create({ data: { organizationId: run!.organizationId, action: 'GROWTH_DELIVERABLE_CREATED', targetType: 'growth_run', targetId: run!.id, metadata: { draftId: draft.id, actionId: action!.id, automatic } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return run.id;
};

const processWordPressPublish = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { draftId?: string; growthRunId?: string; actionId?: string; automated?: boolean };
  if (!payload.draftId || !payload.growthRunId || !payload.actionId) throw new Error('增长发布任务参数不完整');
  const action = await workerPrisma.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId }, include: { run: { include: { program: true } }, site: true } });
  const draft = await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: job.organizationId }, include: { reviews: true } });
  const approved = draft?.reviews.some(({ decision }) => decision === 'APPROVED');
  const automaticRequested = payload.automated === true;
  const manualConfirmationRequired = await requiresManualConfirmation();
  if (!action || !draft || !action.site.wordpressCredentials || draft.status !== DraftStatus.PUBLISHING) throw new Error('草稿或 WordPress 发布门禁不可用');
  if (!approved && automaticRequested && manualConfirmationRequired) {
    await workerPrisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.PENDING_REVIEW } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.REVIEW_REQUIRED } });
      await tx.growthRun.update({ where: { id: action.runId }, data: { status: GrowthRunStatus.NEEDS_REVIEW, delivery: { draftId: draft.id, actionId: action.id, manualReviewRequired: true, reason: 'GLOBAL_PUBLISH_CONFIRMATION_ENABLED' } } });
      await tx.publishAttempt.updateMany({ where: { jobRunId }, data: { status: PublishAttemptStatus.FAILED, errorCode: 'GLOBAL_PUBLISH_CONFIRMATION_ENABLED', errorMessage: '全局发布确认已开启，自动发布改为等待人工确认。', finishedAt: now } });
      await tx.auditEvent.create({ data: { organizationId: job.organizationId, action: 'AUTO_PUBLISH_CONVERTED_TO_REVIEW', targetType: 'growth_action', targetId: action.id, metadata: { policy: 'publishing.confirmation' } } });
    });
    return action.id;
  }
  const automatic = automaticRequested && !manualConfirmationRequired;
  if (!approved && !automatic) throw new Error('草稿尚未通过人工审批');
  let published: { postId: string; url: string };
  if (action.type === GrowthActionType.CREATE_CONTENT) {
    published = await wordPressService.publish({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, title: draft.title, slug: draft.slug, html: draft.html, deliveryId: draft.id });
  } else {
    const snapshot = action.beforeSnapshot as unknown as WordPressEditableSnapshot | null;
    if (!snapshot?.postId || !snapshot.resourceType || !snapshot.content) throw new Error('更新动作缺少可恢复的 WordPress 原始版本');
    published = await wordPressService.update({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, snapshot, title: draft.title, html: draft.html });
  }
  await workerPrisma.$transaction(async (tx) => {
    const now = new Date();
    const gscConnection = await tx.integrationConnection.findFirst({ where: { organizationId: job.organizationId, siteId: action.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED } });
    const baselineSnapshot = gscConnection ? await tx.dataSnapshot.findFirst({ where: { organizationId: job.organizationId, siteId: action.siteId, source: DataSource.GSC, status: DataStatus.LIVE }, orderBy: { fetchedAt: 'desc' } }) : null;
    await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.PUBLISHED, remotePostId: published.postId, publishedUrl: published.url } });
    await tx.publishAttempt.updateMany({ where: { jobRunId }, data: { status: PublishAttemptStatus.SUCCEEDED, remotePostId: published.postId, remoteUrl: published.url, finishedAt: now } });
    await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.OBSERVING, executedAt: now, verifiedAt: now, afterSnapshot: { postId: published.postId, url: published.url, publishedAt: now.toISOString(), mutation: action.type }, observationStartsAt: now, observeUntil: new Date(now.getTime() + 56 * day) } });
    await tx.growthObservation.create({ data: { organizationId: job.organizationId, siteId: action.siteId, actionId: action.id, sourceSnapshotId: baselineSnapshot?.id, baseline: { source: baselineSnapshot ? 'GSC' : 'UNAVAILABLE', snapshotId: baselineSnapshot?.id || null, collectedAt: baselineSnapshot?.fetchedAt || null, note: baselineSnapshot ? 'Pre-action GSC snapshot' : 'GSC not connected; traffic change will not be claimed' } } });
    await tx.growthRun.update({ where: { id: action.runId }, data: { status: GrowthRunStatus.DELIVERED, currentStage: GrowthRunStageCode.LEARN, deliveredAt: now, finishedAt: now, delivery: { draftId: draft.id, actionId: action.id, publishedUrl: published.url, remotePostId: published.postId, deliveredAt: now.toISOString() } } });
    await tx.growthRunStage.update({ where: { runId_stage: { runId: action.runId, stage: GrowthRunStageCode.LEARN } }, data: { status: GrowthRunStageStatus.RUNNING, startedAt: now, summary: gscConnection ? '已交付；等待 14/28/56 天真实 GSC 观察窗口。' : '已交付；未连接 GSC，仅验证页面可访问性与 Sitemap 发现线索。', evidence: [{ type: 'WORDPRESS_DELIVERY', url: published.url, deliveredAt: now.toISOString() }] } });
    await tx.growthProgram.update({ where: { id: action.run.programId }, data: { status: action.run.program.mode === GrowthProgramMode.ONCE ? GrowthProgramStatus.COMPLETED : GrowthProgramStatus.ACTIVE, deliveredRunCount: { increment: 1 }, lastRunAt: now, lastError: null } });
    await jobService.create(tx, { organizationId: job.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `growth-indexing:${action.id}:1`, payload: { draftId: draft.id, growthRunId: action.runId, actionId: action.id, observationNumber: 1 }, availableAt: new Date(now.getTime() + 60 * 60_000) });
    if (gscConnection) {
      for (const windowDays of [14, 28, 56]) {
        await jobService.create(tx, { organizationId: job.organizationId, type: JobType.GROWTH_MEASURE, idempotencyKey: `growth-measure:${action.id}:${windowDays}`, payload: { growthRunId: action.runId, actionId: action.id, windowDays }, availableAt: new Date(now.getTime() + windowDays * day) });
      }
    }
    await tx.auditEvent.create({ data: { organizationId: job.organizationId, action: 'GROWTH_ACTION_PUBLISHED', targetType: 'growth_action', targetId: action.id, metadata: { ...published, type: action.type, gscObservationScheduled: Boolean(gscConnection) } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return draft.id;
};

const processIndexingMonitor = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { draftId?: string; growthRunId?: string; actionId?: string; observationNumber?: number };
  if (!payload.draftId || !payload.growthRunId || !payload.actionId) throw new Error('交付观察参数不完整');
  const draft = await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: job.organizationId }, include: { site: true } });
  if (!draft?.publishedUrl) throw new Error('交付观察缺少已发布 URL');
  const page = await fetch(draft.publishedUrl, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } });
  if (!page.ok) throw new Error(`已发布页面不可访问 (${page.status})`);
  const origin = await resolvePublicHttpsOrigin(draft.site.domain);
  let sitemapStatus: DataStatus = DataStatus.UNAVAILABLE;
  let sitemapPresent = false;
  let sitemapUrl: string | undefined;
  for (const path of ['/wp-sitemap.xml', '/sitemap.xml']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'application/xml,text/xml' } });
    if (response.ok) {
      sitemapUrl = `${origin}${path}`;
      sitemapPresent = (await response.text()).includes(draft.publishedUrl);
      sitemapStatus = DataStatus.LIVE;
      break;
    }
  }
  const observationNumber = Math.max(1, Number(payload.observationNumber) || 1);
  return workerPrisma.$transaction(async (tx) => {
    const observation = await tx.indexingObservation.create({ data: { organizationId: job.organizationId, siteId: draft.siteId, draftId: draft.id, url: draft.publishedUrl!, source: 'SITEMAP', indexed: null, status: sitemapStatus, observedAt: new Date(), payload: { pageStatus: page.status, sitemapUrl: sitemapUrl || null, sitemapPresent, observationNumber, note: 'Sitemap presence is a discovery signal, never proof of Google indexing' } } });
    const gsc = await tx.integrationConnection.findFirst({ where: { organizationId: job.organizationId, siteId: draft.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED } });
    const finalLeadingObservation = observationNumber >= 7;
    await tx.growthRun.update({ where: { id: payload.growthRunId! }, data: { observation: { lastIndexingObservationId: observation.id, pageAccessible: true, sitemapPresent, observationNumber, gscConnected: Boolean(gsc), trafficVerified: false } } });
    if (!gsc && finalLeadingObservation) {
      await tx.growthRunStage.update({ where: { runId_stage: { runId: payload.growthRunId!, stage: GrowthRunStageCode.LEARN } }, data: { status: GrowthRunStageStatus.COMPLETED, summary: '已验证页面持续可访问及 Sitemap 发现线索；未连接 GSC，不宣称流量增长或已收录。', processedCount: observationNumber, totalCount: observationNumber, finishedAt: new Date(), evidence: [{ type: 'LEADING_INDICATORS', pageAccessible: true, sitemapPresent, trafficVerified: false }] } });
      await tx.growthAction.update({ where: { id: payload.actionId! }, data: { status: GrowthActionStatus.SUCCEEDED, verifiedAt: new Date() } });
      await tx.growthObservation.updateMany({ where: { actionId: payload.actionId!, status: 'WAITING' }, data: { status: 'EVALUATED', measurement: { pageAccessible: true, sitemapPresent, trafficVerified: false }, outcome: 'INCONCLUSIVE', evaluatedAt: new Date() } });
    } else if (!finalLeadingObservation) {
      await jobService.create(tx, { organizationId: job.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `growth-indexing:${payload.actionId}:${observationNumber + 1}`, payload: { ...payload, observationNumber: observationNumber + 1 }, availableAt: new Date(Date.now() + day) });
    }
    return observation.id;
  });
};

const aggregateGsc = (rows: ReturnType<typeof readGscRows>, targetUrl?: string | null) => {
  const selected = targetUrl ? rows.filter((row) => row.keys[1] === targetUrl) : rows;
  const clicks = selected.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = selected.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = impressions ? selected.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : null;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : null, position: weightedPosition, rowCount: selected.length };
};

const gscSnapshotPayload = (
  period: { startDate: string; endDate: string },
  rows: ReturnType<typeof readGscRows>
): Prisma.InputJsonObject => ({
  period: { startDate: period.startDate, endDate: period.endDate },
  rows: rows.map((row) => ({
    keys: row.keys.filter((key): key is string => typeof key === 'string'),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position
  }))
});

const processGrowthMeasure = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { growthRunId?: string; actionId?: string; windowDays?: number };
  if (!payload.growthRunId || !payload.actionId || ![14, 28, 56].includes(payload.windowDays || 0)) throw new Error('GSC 观察参数不完整');
  const action = await workerPrisma.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId }, include: { run: true, site: { include: { integrations: { where: { provider: 'GSC', status: SiteConnectionStatus.CONNECTED }, take: 1 } } } } });
  const connection = action?.site.integrations[0];
  if (!action || !connection?.propertyId || !action.executedAt) throw new Error('GSC 观察连接或动作时间不可用');
  const credentials = decryptSecret<{ refreshToken: string }>(Buffer.from(connection.encryptedCredentials));
  const end = new Date(Date.now() - 3 * day);
  const start = new Date(end.getTime() - ((payload.windowDays || 14) - 1) * day);
  const window = gscComparisonWindow(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  if (!window) throw new Error('GSC 观察窗口无效');
  const [current, previous] = await Promise.all([
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.current }),
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.previous })
  ]);
  const currentMetrics = aggregateGsc(readGscRows({ rows: current.rows }), action.targetUrl);
  const previousMetrics = aggregateGsc(readGscRows({ rows: previous.rows }), action.targetUrl);
  const enoughData = currentMetrics.impressions >= 20;
  const clickDelta = currentMetrics.clicks - previousMetrics.clicks;
  const outcome = !enoughData ? 'INCONCLUSIVE' : clickDelta > 0 ? 'WIN' : clickDelta < 0 ? 'LOSS' : 'NEUTRAL';
  return workerPrisma.$transaction(async (tx) => {
    const previousSnapshot = await tx.dataSnapshot.create({ data: { organizationId: job.organizationId, siteId: action.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.previous.startDate}T00:00:00Z`), periodEnd: new Date(`${window.previous.endDate}T00:00:00Z`), payload: gscSnapshotPayload(window.previous, readGscRows({ rows: previous.rows })) } });
    const snapshot = await tx.dataSnapshot.create({ data: { organizationId: job.organizationId, siteId: action.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.current.startDate}T00:00:00Z`), periodEnd: new Date(`${window.current.endDate}T00:00:00Z`), comparisonSnapshotId: previousSnapshot.id, payload: gscSnapshotPayload(window.current, readGscRows({ rows: current.rows })) } });
    const finalWindow = payload.windowDays === 56;
    const observation = await tx.growthObservation.updateMany({ where: { actionId: action.id }, data: { status: enoughData || finalWindow ? 'EVALUATED' : 'WAITING', sourceSnapshotId: snapshot.id, measurement: { windowDays: payload.windowDays, current: currentMetrics, previous: previousMetrics, clickDelta, statement: 'Observed change after the action; not asserted as absolute causation' }, estimatedLiftMicros: BigInt(Math.round(clickDelta * 1_000_000)), confidenceMicros: BigInt(Math.min(1_000_000, Math.round(currentMetrics.impressions / 1000 * 1_000_000))), outcome, observedAt: new Date(), evaluatedAt: enoughData || finalWindow ? new Date() : null } });
    await tx.growthRun.update({ where: { id: payload.growthRunId! }, data: { observation: { source: 'GSC', windowDays: payload.windowDays, current: currentMetrics, previous: previousMetrics, clickDelta, outcome, enoughData, causalClaim: false } } });
    if (payload.windowDays === 56) {
      await tx.growthRunStage.update({ where: { runId_stage: { runId: payload.growthRunId!, stage: GrowthRunStageCode.LEARN } }, data: { status: GrowthRunStageStatus.COMPLETED, summary: enoughData ? `已完成 56 天 GSC 观察：行动后自然点击变化 ${clickDelta >= 0 ? '+' : ''}${clickDelta}。` : '56 天窗口仍无足够 GSC 数据，不生成增长结论。', processedCount: 3, totalCount: 3, finishedAt: new Date(), evidence: [{ type: 'GSC_OBSERVATION', snapshotId: snapshot.id, windowDays: 56, outcome, causalClaim: false }] } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.SUCCEEDED, verifiedAt: new Date() } });
      if (outcome === 'WIN') await tx.growthProgram.update({ where: { id: action.run.programId }, data: { consecutiveWins: { increment: 1 } } });
    }
    return `${action.id}:${payload.windowDays}:${observation.count}`;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const processWordPressRollback = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { draftId?: string; actionId?: string };
  if (!payload.draftId) throw new Error('回滚任务缺少 draftId');
  const draft = await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: job.organizationId }, include: { site: true } });
  const action = payload.actionId ? await workerPrisma.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId } }) : null;
  if (!draft?.site.wordpressCredentials || !draft.remotePostId) throw new Error('没有可回滚的 WordPress 交付');
  if (action && action.type !== GrowthActionType.CREATE_CONTENT) {
    const snapshot = action.beforeSnapshot as unknown as WordPressEditableSnapshot | null;
    if (!snapshot?.postId || !snapshot.content) throw new Error('更新动作缺少原始 WordPress 版本');
    await wordPressService.restore({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, snapshot });
  } else {
    await wordPressService.rollback({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, postId: draft.remotePostId });
  }
  await workerPrisma.$transaction(async (tx) => {
    await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.ROLLED_BACK } });
    await tx.publishAttempt.updateMany({ where: { draftId: draft.id, status: PublishAttemptStatus.SUCCEEDED }, data: { status: PublishAttemptStatus.ROLLED_BACK } });
    if (action) await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.ROLLED_BACK, rolledBackAt: new Date() } });
    await tx.auditEvent.create({ data: { organizationId: job.organizationId, action: 'GROWTH_ACTION_ROLLED_BACK', targetType: 'content_draft', targetId: draft.id, metadata: { actionId: action?.id || null, restoredPreviousVersion: Boolean(action && action.type !== GrowthActionType.CREATE_CONTENT) } } });
  });
  return draft.id;
};

const processPayment = async (jobRunId: string): Promise<{ deferred: boolean; resultId?: string }> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const paymentIntentId = (job.payload as { paymentIntentId?: string }).paymentIntentId;
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
      await getProductionQueue().add(JobType.PAYMENT_VERIFY, { jobRunId }, productionJobOptions(`${jobRunId}:verify:${bucket}`, { delay: 30_000 }));
      await workerPrisma.jobRun.update({ where: { id: jobRunId }, data: { status: JobStatus.QUEUED, heartbeatAt: new Date(), errorCode: 'PAYMENT_PENDING', errorMessage: error instanceof Error ? error.message : String(error) } });
      return { deferred: true };
    }
    throw error;
  }
};

const processGscSync = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { connectionId?: string; startDate?: string; endDate?: string };
  const connection = payload.connectionId ? await workerPrisma.integrationConnection.findUnique({ where: { id: payload.connectionId } }) : null;
  if (!connection?.propertyId || !payload.startDate || !payload.endDate) throw new Error('GSC 同步参数不完整');
  const window = gscComparisonWindow(payload.startDate, payload.endDate);
  if (!window || window.periodDays < 7 || window.periodDays > 90) throw new Error('GSC 同步窗口必须为 7 到 90 天');
  const credentials = decryptSecret<{ refreshToken: string }>(Buffer.from(connection.encryptedCredentials));
  const [current, previous] = await Promise.all([
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.current }),
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.previous })
  ]);
  return workerPrisma.$transaction(async (tx) => {
    const previousSnapshot = await tx.dataSnapshot.create({ data: { organizationId: connection.organizationId, siteId: connection.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.previous.startDate}T00:00:00Z`), periodEnd: new Date(`${window.previous.endDate}T00:00:00Z`), payload: gscSnapshotPayload(window.previous, readGscRows({ rows: previous.rows })) } });
    const snapshot = await tx.dataSnapshot.create({ data: { organizationId: connection.organizationId, siteId: connection.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.current.startDate}T00:00:00Z`), periodEnd: new Date(`${window.current.endDate}T00:00:00Z`), comparisonSnapshotId: previousSnapshot.id, payload: gscSnapshotPayload(window.current, readGscRows({ rows: current.rows })) } });
    await tx.integrationConnection.update({ where: { id: connection.id }, data: { status: SiteConnectionStatus.CONNECTED, lastSyncedAt: new Date(), lastErrorCode: null, lastErrorMessage: null } });
    return snapshot.id;
  });
};

const markFailed = async (jobRunId: string, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  await workerPrisma.$transaction(async (tx) => {
    const job = await tx.jobRun.findUnique({ where: { id: jobRunId } });
    if (!job) return;
    const finalAttempt = job.attempts >= 5;
    await tx.jobRun.update({ where: { id: jobRunId }, data: { status: finalAttempt ? JobStatus.DEAD_LETTER : JobStatus.QUEUED, queueJobId: finalAttempt ? job.queueJobId : null, errorCode: 'JOB_EXECUTION_FAILED', errorMessage: message.slice(0, 2_000), finishedAt: finalAttempt ? new Date() : null } });
    if (!finalAttempt) return;
    await billingService.releaseCreditHold(tx, jobRunId);
    const payload = job.payload as { growthRunId?: string; actionId?: string; draftId?: string; connectionId?: string; windowDays?: number };
    if (job.type === JobType.GROWTH_MEASURE) {
      if (payload.actionId) {
        const finalWindow = payload.windowDays === 56;
        await tx.growthObservation.updateMany({ where: { actionId: payload.actionId }, data: { status: finalWindow ? 'EVALUATED' : 'WAITING', measurement: { source: 'GSC', available: false, windowDays: payload.windowDays || null, error: message }, outcome: finalWindow ? 'INCONCLUSIVE' : undefined, evaluatedAt: finalWindow ? new Date() : null } });
        if (finalWindow) await tx.growthAction.updateMany({ where: { id: payload.actionId }, data: { status: GrowthActionStatus.SUCCEEDED, verifiedAt: new Date() } });
      }
      if (payload.growthRunId && payload.windowDays === 56) {
        await tx.growthRunStage.updateMany({ where: { runId: payload.growthRunId, stage: GrowthRunStageCode.LEARN }, data: { status: GrowthRunStageStatus.FAILED, summary: 'GSC 观察在重试后仍不可用；本次 WordPress 交付保持成功，但不生成流量结论。', errorCode: 'GSC_OBSERVATION_UNAVAILABLE', errorMessage: message.slice(0, 2_000), finishedAt: new Date() } });
      }
      return;
    }
    if (payload.growthRunId) {
      const run = await tx.growthRun.findUnique({ where: { id: payload.growthRunId } });
      if (run) {
        await tx.growthRunStage.updateMany({ where: { runId: run.id, stage: run.currentStage }, data: { status: GrowthRunStageStatus.FAILED, errorCode: 'STAGE_EXECUTION_FAILED', errorMessage: message.slice(0, 2_000), finishedAt: new Date() } });
        await tx.growthRun.update({ where: { id: run.id }, data: { status: GrowthRunStatus.FAILED, errorCode: 'GROWTH_RUN_FAILED', errorMessage: message.slice(0, 2_000), finishedAt: new Date() } });
        if (run.programId) await tx.growthProgram.update({ where: { id: run.programId }, data: { status: GrowthProgramStatus.BLOCKED, lockedUntil: null, lastError: message.slice(0, 1_000) } });
      }
    }
    if (payload.actionId) await tx.growthAction.updateMany({ where: { id: payload.actionId }, data: { status: GrowthActionStatus.FAILED, afterSnapshot: { error: message } } });
    if (payload.draftId) {
      await tx.contentDraft.updateMany({ where: { id: payload.draftId }, data: { status: DraftStatus.PUBLISH_FAILED } });
      await tx.publishAttempt.updateMany({ where: { jobRunId }, data: { status: PublishAttemptStatus.FAILED, errorCode: 'WORDPRESS_PUBLISH_FAILED', errorMessage: message, finishedAt: new Date() } });
    }
    if (payload.connectionId) await tx.integrationConnection.updateMany({ where: { id: payload.connectionId }, data: { status: SiteConnectionStatus.FAILED, lastErrorCode: 'GSC_SYNC_FAILED', lastErrorMessage: message } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const reconcile = async (): Promise<void> => {
  const queue = getProductionQueue();
  const capabilities = productionConfigurationStatus('worker').providers;
  await workerPrisma.workerHeartbeat.upsert({ where: { workerId }, create: { workerId, queues: [PRODUCTION_QUEUE], processVersion: process.env.RAILWAY_GIT_COMMIT_SHA || 'development', capabilities, heartbeatAt: new Date(), startedAt }, update: { heartbeatAt: new Date(), queues: [PRODUCTION_QUEUE], capabilities } });
  await workerPrisma.paymentIntent.updateMany({ where: { status: { in: [PaymentStatus.AWAITING_TRANSFER, PaymentStatus.VERIFYING] }, expiresAt: { lt: new Date() } }, data: { status: PaymentStatus.EXPIRED } });
  await workerPrisma.jobRun.updateMany({ where: { status: JobStatus.RUNNING, heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) }, attempts: { lt: 5 } }, data: { status: JobStatus.QUEUED, queueJobId: null, errorCode: 'STALE_WORKER_RECOVERED', errorMessage: 'Recovered from stale worker heartbeat' } });
  const exhaustedStaleJobs = await workerPrisma.jobRun.findMany({
    where: { status: JobStatus.RUNNING, heartbeatAt: { lt: new Date(Date.now() - 10 * 60_000) }, attempts: { gte: 5 } },
    select: { id: true }
  });
  for (const staleJob of exhaustedStaleJobs) {
    await workerPrisma.$transaction(async (tx) => {
      await tx.jobRun.updateMany({ where: { id: staleJob.id, status: JobStatus.RUNNING }, data: { status: JobStatus.DEAD_LETTER, finishedAt: new Date(), errorCode: 'MAX_ATTEMPTS_EXCEEDED' } });
      await billingService.releaseCreditHold(tx, staleJob.id);
    });
  }

  const claimedPrograms = await workerPrisma.$transaction((tx) => tx.$queryRaw<Array<{ id: string }>>`
    WITH due AS (
      SELECT id FROM public.growth_programs
      WHERE mode = 'CONTINUOUS' AND status = 'ACTIVE' AND next_run_at <= now()
        AND (locked_until IS NULL OR locked_until < now())
      ORDER BY next_run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 50
    )
    UPDATE public.growth_programs program
    SET locked_until = now() + interval '5 minutes'
    FROM due WHERE program.id = due.id
    RETURNING program.id
  `, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (const { id } of claimedPrograms) {
    try {
      await workerPrisma.$transaction(async (tx) => {
        const program = await tx.growthProgram.findUniqueOrThrow({ where: { id } });
        const activeRun = await tx.growthRun.findFirst({ where: { programId: id, status: { in: [GrowthRunStatus.QUEUED, GrowthRunStatus.RUNNING, GrowthRunStatus.NEEDS_REVIEW] } } });
        if (activeRun) {
          await tx.growthProgram.update({ where: { id }, data: { lockedUntil: null, nextRunAt: new Date(Date.now() + day), lastError: '上一轮仍在执行或等待审批' } });
          return;
        }
        const occurrenceKey = program.nextRunAt?.toISOString() || new Date().toISOString();
        await growthProgramService.createScheduledRun(tx, { organizationId: program.organizationId, programId: id, siteId: program.siteId, occurrenceKey });
        const intervalDays = continuousCadenceDays(program.consecutiveWins);
        await tx.growthProgram.update({ where: { id }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + intervalDays * day), lockedUntil: null, lastError: null } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await workerPrisma.growthProgram.updateMany({ where: { id }, data: { status: GrowthProgramStatus.BLOCKED, lockedUntil: null, lastError: message.slice(0, 1_000) } });
      Sentry.captureException(error, { tags: { subsystem: 'growth-reconcile', growthProgramId: id } });
    }
  }

  const [queuedCount, ledgerDifferences] = await Promise.all([
    workerPrisma.jobRun.count({ where: { status: JobStatus.QUEUED } }),
    workerPrisma.$queryRaw<Array<{ organization_id: string }>>`
      SELECT organization.id AS organization_id
      FROM public.organizations organization
      LEFT JOIN LATERAL (
        SELECT balance_after_micros FROM public.ledger_entries entry
        WHERE entry.organization_id = organization.id ORDER BY entry.created_at DESC, entry.id DESC LIMIT 1
      ) latest ON true
      WHERE organization.credit_balance_micros <> coalesce(latest.balance_after_micros, 0)
    `
  ]);
  if (queuedCount > Number(process.env.QUEUE_BACKLOG_ALERT_THRESHOLD || 100)) Sentry.captureMessage(`AISEO queue backlog: ${queuedCount}`, 'warning');
  if (ledgerDifferences.length) Sentry.captureMessage(`AISEO ledger mismatch: ${ledgerDifferences.length}`, { level: 'fatal' });

  const queued = await workerPrisma.jobRun.findMany({ where: { status: JobStatus.QUEUED, availableAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: 500 });
  for (const job of queued) {
    const queueJob = await queue.add(job.type, { jobRunId: job.id }, productionJobOptions(job.id));
    await workerPrisma.jobRun.update({ where: { id: job.id }, data: { queueJobId: String(queueJob.id) } });
  }
};

export const createProductionWorker = () => new Worker<QueuePayload>(PRODUCTION_QUEUE, async (queueJob: Job<QueuePayload>) => {
  if (queueJob.data.system || queueJob.name === JobType.AUTOMATION_RECONCILE) {
    await reconcile();
    return;
  }
  const jobRunId = queueJob.data.jobRunId;
  if (!jobRunId) throw new Error('队列任务缺少 jobRunId');
  const job = await workerPrisma.jobRun.update({ where: { id: jobRunId }, data: { status: JobStatus.RUNNING, attempts: { increment: 1 }, startedAt: { set: new Date() }, heartbeatAt: new Date(), errorCode: null, errorMessage: null } });
  const heartbeatTimer = setInterval(() => {
    void workerPrisma.jobRun.updateMany({ where: { id: jobRunId, status: JobStatus.RUNNING }, data: { heartbeatAt: new Date() } })
      .catch((error) => Sentry.captureException(error, { tags: { subsystem: 'job-heartbeat', jobRunId } }));
  }, 30_000);
  heartbeatTimer.unref();
  try {
    let resultId: string | undefined;
    let deferred = false;
    switch (job.type) {
      case JobType.GROWTH_RUN: resultId = await processGrowthRun(jobRunId); break;
      case JobType.WORDPRESS_PUBLISH: resultId = await processWordPressPublish(jobRunId); break;
      case JobType.WORDPRESS_ROLLBACK: resultId = await processWordPressRollback(jobRunId); break;
      case JobType.INDEXING_MONITOR: resultId = await processIndexingMonitor(jobRunId); break;
      case JobType.GROWTH_MEASURE: resultId = await processGrowthMeasure(jobRunId); break;
      case JobType.PAYMENT_VERIFY: ({ resultId, deferred } = await processPayment(jobRunId)); break;
      case JobType.GSC_SYNC: resultId = await processGscSync(jobRunId); break;
      default: throw new Error(`Worker 不支持已停用的作业类型 ${job.type}`);
    }
    if (!deferred) await workerPrisma.jobRun.update({ where: { id: jobRunId }, data: { status: JobStatus.SUCCEEDED, result: resultId ? { resultId } : undefined, finishedAt: new Date(), heartbeatAt: new Date() } });
  } catch (error) {
    await markFailed(jobRunId, error);
    throw error;
  } finally {
    clearInterval(heartbeatTimer);
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

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.cjs')) {
  void startProductionWorker().catch((error) => { logger.error('WORKER_BOOT', 'Worker failed to start', { data: error }); process.exit(1); });
}
