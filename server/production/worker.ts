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
  MeasurementSource,
  PageVersionKind,
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
import { extractGscOpportunitySeeds, gscComparisonWindow, readGscRows } from './gscData';
import { continuousCadenceDays, selectGrowthAction } from './growthPolicy';
import { growthProgramService } from './growthProgramService';
import { jobService } from './jobService';
import { dataForSeoProvider, gscProvider, tronGridProvider } from './providers';
import { closeQueue, getProductionQueue, getQueueConnection, PRODUCTION_QUEUE, productionJobOptions } from './queue';
import { capturePublicSource, type CapturedSource } from './sourceFetcher';
import { assessSourceOriginality, deterministicActionQualityGate, insertContextualInternalLinks, selectRelevantInternalLinks } from './seoPipeline';
import { resolveSeoMarket } from './seoMarket';
import type { SeoMarket } from './seoMarket';
import { wordPressService, type WordPressEditableSnapshot, type WordPressSiteContext } from './wordpress';
import { applyObservedActionMultiplier, contentCoverageScore, findCannibalizationMatch, scoreKeywordCandidate } from './growthDiscovery';
import { actionMeasurementWindow, aggregateTargetGsc, evaluateGrowthOutcome } from './growthMeasurement';
import { persistSiteSnapshot } from './siteSnapshotService';
import { disconnectWorkerDatabase, workerPrisma } from './workerPrisma';
import { assertDatabaseSecurity } from './databaseSecurity';
import { logger } from '../utils/logger';
import { resolvePublicHttpsOrigin } from '../utils/networkSafety';
import { ConflictError, ValidationError } from '../domain/errors';
import { parsePublishingConfirmationPolicy, PUBLISH_CONFIRMATION_SETTING_KEY } from './publishingPolicy';

type QueuePayload = { jobRunId?: string; system?: boolean };
type Evidence = Array<Record<string, unknown>>;

const workerId = `${process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID().slice(0, 8)}`;
const startedAt = new Date();
const day = 86_400_000;
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);
const wordPressDate = (value?: string): Date | undefined => value
  ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z')
  : undefined;
const comparableUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
};

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
    if (stageRow.status === GrowthRunStageStatus.COMPLETED || stageRow.status === GrowthRunStageStatus.SKIPPED) return;
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

const brandTermsFromContext = (context: WordPressSiteContext): string[] => [
  context.site.name,
  new URL(context.normalizedUrl).hostname.replace(/^www\./, '').split('.')[0]
].filter((value) => value.trim().length >= 2);

const acquireSiteMutationLease = async (input: {
  organizationId: string;
  siteId: string;
  runId: string;
  actionId: string;
}): Promise<string> => {
  const leaseToken = randomUUID();
  const claimed = await workerPrisma.$queryRaw<Array<{ lease_token: string }>>`
    INSERT INTO public.site_mutation_leases (
      organization_id, site_id, run_id, action_id, lease_token, acquired_at, expires_at
    ) VALUES (
      ${input.organizationId}::uuid, ${input.siteId}::uuid, ${input.runId}::uuid,
      ${input.actionId}::uuid, ${leaseToken}::uuid, now(), now() + interval '5 minutes'
    )
    ON CONFLICT (site_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          run_id = EXCLUDED.run_id,
          action_id = EXCLUDED.action_id,
          lease_token = EXCLUDED.lease_token,
          acquired_at = now(),
          expires_at = now() + interval '5 minutes'
      WHERE public.site_mutation_leases.expires_at < now()
         OR public.site_mutation_leases.action_id = EXCLUDED.action_id
    RETURNING lease_token::text
  `;
  if (!claimed[0]) throw new ConflictError('该站点已有其他修改正在执行，当前动作将在释放站点锁后重试');
  return claimed[0].lease_token;
};

const releaseSiteMutationLease = async (siteId: string, leaseToken: string): Promise<void> => {
  await workerPrisma.siteMutationLease.deleteMany({ where: { siteId, leaseToken } });
};

type WordPressSiteHealth = Awaited<ReturnType<typeof wordPressService.inspectSiteHealth>>;
const recordValue = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const storedLinks = (value: unknown): Array<{ url: string; anchor: string }> => Array.isArray(value)
  ? value.flatMap((item) => {
    const link = recordValue(item);
    return typeof link.url === 'string' && typeof link.anchor === 'string' ? [{ url: link.url, anchor: link.anchor }] : [];
  })
  : [];

const restorePersistedUnderstanding = async (run: {
  id: string;
  organizationId: string;
  knowledgeSourceIds: string[];
  site: { name: string };
}) => {
  const snapshot = await workerPrisma.siteSnapshot.findUnique({ where: { runId: run.id }, include: { pages: true } });
  if (!snapshot) return null;
  const sources = await workerPrisma.knowledgeSource.findMany({ where: { id: { in: run.knowledgeSourceIds }, organizationId: run.organizationId, status: DataStatus.LIVE } });
  const targetSource = sources.find(({ title }) => title.startsWith('[TARGET_SITE]'));
  if (!targetSource?.normalizedUrl || sources.length !== run.knowledgeSourceIds.length) {
    throw new Error('已完成的网站理解阶段缺少不可变站点语料，拒绝重新抓取并混用不同证据版本');
  }
  const savedHealth = recordValue(snapshot.health);
  const savedRobots = recordValue(savedHealth.robots);
  const savedSitemap = recordValue(savedHealth.sitemap);
  const savedSite = recordValue(savedHealth.site);
  const savedInventory = recordValue(savedHealth.inventory);
  const health: WordPressSiteHealth = {
    origin: String(savedHealth.origin || targetSource.normalizedUrl),
    homepageStatus: Number(savedHealth.homepageStatus),
    canonical: typeof savedHealth.canonical === 'string' ? savedHealth.canonical : null,
    robots: {
      status: Number(savedRobots.status),
      available: savedRobots.available === true,
      blocksAll: savedRobots.blocksAll === true
    },
    sitemap: {
      url: typeof savedSitemap.url === 'string' ? savedSitemap.url : null,
      status: typeof savedSitemap.status === 'number' ? savedSitemap.status : null,
      available: savedSitemap.available === true
    },
    restApi: savedHealth.restApi === true
  };
  if (!health.origin.startsWith('https://') || !Number.isFinite(health.homepageStatus)) {
    throw new Error('已持久化的网站理解证据结构无效');
  }
  const pages = snapshot.pages.map((page) => ({
    wordpressId: page.wordpressId || '',
    resourceType: page.resourceType,
    url: page.url,
    slug: page.slug,
    status: page.status,
    modifiedAt: page.modifiedAt?.toISOString(),
    title: page.title,
    excerpt: page.excerpt || '',
    content: page.content,
    contentChecksum: page.contentChecksum,
    wordCount: page.wordCount,
    internalLinks: storedLinks(page.internalLinks),
    seoMetadata: recordValue(page.seoMetadata)
  }));
  const targetContext: WordPressSiteContext = {
    normalizedUrl: targetSource.normalizedUrl,
    title: targetSource.title,
    content: targetSource.content,
    checksum: snapshot.corpusChecksum,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    internalLinks: pages.map(({ title, url }) => ({ title, url })),
    pages,
    site: {
      name: String(savedSite.name || run.site.name),
      description: String(savedSite.description || ''),
      locale: typeof savedSite.locale === 'string' ? savedSite.locale : undefined,
      url: String(savedSite.url || targetSource.normalizedUrl)
    },
    inventory: {
      resourceTypes: Array.isArray(savedInventory.resourceTypes) ? savedInventory.resourceTypes.filter((value): value is string => typeof value === 'string') : [],
      categories: Number(savedInventory.categories || 0),
      tags: Number(savedInventory.tags || 0),
      media: Number(savedInventory.media || 0),
      categoriesAvailable: savedInventory.categoriesAvailable === true,
      tagsAvailable: savedInventory.tagsAvailable === true,
      mediaAvailable: savedInventory.mediaAvailable === true
    }
  };
  const externalKnowledge = sources.find(({ id }) => id !== targetSource.id);
  const externalSource: CapturedSource | undefined = externalKnowledge?.normalizedUrl ? {
    normalizedUrl: externalKnowledge.normalizedUrl,
    title: externalKnowledge.title.replace(/^\[(?:REFERENCE|COMPETITOR)]\s*/, ''),
    content: externalKnowledge.content,
    checksum: externalKnowledge.checksum,
    fetchedAt: (externalKnowledge.fetchedAt || externalKnowledge.createdAt).toISOString()
  } : undefined;
  return {
    health,
    targetContext,
    market: snapshot.market as unknown as SeoMarket,
    externalSource,
    sourceIds: run.knowledgeSourceIds,
    siteSnapshotId: snapshot.id
  };
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
  if (run.draftId) return run.id;
  if (run.site.wordpressStatus !== SiteConnectionStatus.CONNECTED || !run.site.wordpressCredentials || !run.site.wordpressVerifiedAt) {
    throw new ValidationError('WordPress 连接未通过验证，无法执行真实站点分析');
  }

  const latestGscSnapshot = await workerPrisma.dataSnapshot.findFirst({
    where: { organizationId: run.organizationId, siteId: run.siteId, source: DataSource.GSC, status: DataStatus.LIVE },
    orderBy: { fetchedAt: 'desc' }
  });
  const previousGscSnapshot = latestGscSnapshot?.comparisonSnapshotId
    ? await workerPrisma.dataSnapshot.findUnique({ where: { id: latestGscSnapshot.comparisonSnapshotId } })
    : null;
  const currentGscRows = readGscRows(latestGscSnapshot?.payload);
  const previousGscRows = readGscRows(previousGscSnapshot?.payload);
  const gscCountries = new Map<string, number>();
  for (const row of currentGscRows) {
    if (row.keys[2]) gscCountries.set(row.keys[2], (gscCountries.get(row.keys[2]) || 0) + row.impressions);
  }
  await startStage(run.id, GrowthRunStageCode.UNDERSTAND);
  let understanding = await restorePersistedUnderstanding(run);
  if (!understanding) {
    const [health, targetContext] = await Promise.all([
      wordPressService.inspectSiteHealth(run.site.domain),
      wordPressService.readSiteContext(run.site.domain, run.site.wordpressCredentials).catch(async (error): Promise<WordPressSiteContext> => {
        if (!(error instanceof ValidationError) || !error.message.includes('没有足够')) throw error;
        const source = await capturePublicSource(run!.site.domain);
        return {
          ...source,
          internalLinks: [],
          pages: [],
          site: { name: source.title, description: '', url: source.normalizedUrl },
          inventory: { resourceTypes: [], categories: 0, tags: 0, media: 0 }
        };
      })
    ]);
    const market = resolveSeoMarket({
      domain: run.site.domain,
      language: run.site.language,
      siteLocale: targetContext.site.locale,
      defaultLocationCode: env.defaultSeoLocationCode,
      gscCountries: [...gscCountries].map(([country, impressions]) => ({ country, impressions }))
    });
    const [pageAudits, externalSource] = await Promise.all([
      dataForSeoProvider.auditPages(targetContext.pages.map(({ url }) => url)),
      run.program.inputType === 'KEYWORD' ? Promise.resolve(undefined) : capturePublicSource(run.program.inputValue)
    ]);
    understanding = await workerPrisma.$transaction(async (tx) => {
      const ids = [await persistSource(tx, { organizationId: run!.organizationId, siteId: run!.siteId, prefix: '[TARGET_SITE]', source: targetContext })];
      if (externalSource) {
        ids.push(await persistSource(tx, {
          organizationId: run!.organizationId,
          siteId: run!.siteId,
          prefix: run!.program.inputType === 'REFERENCE_URL' ? '[REFERENCE]' : '[COMPETITOR]',
          source: externalSource
        }));
      }
      const siteSnapshot = await persistSiteSnapshot(tx, {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        runId: run!.id,
        context: targetContext,
        health,
        market,
        audits: pageAudits
      });
      await tx.growthRun.update({ where: { id: run!.id }, data: { knowledgeSourceIds: ids } });
      await completeStage(tx, {
        runId: run!.id,
        stage: GrowthRunStageCode.UNDERSTAND,
        summary: `已验证 WordPress、HTTPS 与站点结构，读取 ${targetContext.pages.length} 个公开页面并完成 ${pageAudits.length} 个页面的技术审计。`,
        processedCount: targetContext.pages.length,
        totalCount: targetContext.pages.length,
        evidence: [{ type: 'SITE_HEALTH', ...health }, { type: 'SITE_SNAPSHOT', siteSnapshotId: siteSnapshot.id, pageCount: targetContext.pages.length, auditedPageCount: pageAudits.length, market }, { type: 'SITE_CORPUS', sourceId: ids[0], checksum: targetContext.checksum }, ...(externalSource ? [{ type: run!.program.inputType, sourceId: ids[1], checksum: externalSource.checksum }] : [])]
      });
      return { health, targetContext, market, externalSource, sourceIds: ids, siteSnapshotId: siteSnapshot.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  const { health, targetContext, market, externalSource, sourceIds, siteSnapshotId } = understanding;

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
  let scoredCandidates: ReturnType<typeof scoreKeywordCandidate>[] = [];
  let gscSignalCount = 0;
  if (!opportunity) {
    const discoveredByProvider = await dataForSeoProvider.discoverKeywords({
      seedKeyword: keyword,
      languageCode: market.languageCode,
      locationCode: market.locationCode,
      targetDomain: new URL(targetContext.normalizedUrl).hostname,
      competitorDomain: run.program.inputType === 'COMPETITOR_SITE' && externalSource
        ? new URL(externalSource.normalizedUrl).hostname
        : undefined
    });
    const siteHostname = new URL(targetContext.normalizedUrl).hostname.replace(/^www\./, '');
    const gscSeeds = extractGscOpportunitySeeds({
      current: currentGscRows,
      previous: previousGscRows,
      brandTerms: [targetContext.site.name, siteHostname, siteHostname.split('.')[0]].filter(Boolean)
    });
    gscSignalCount = gscSeeds.length;
    const discoveredByKeyword = new Map(discoveredByProvider.map((candidate) => [
      candidate.keyword.toLocaleLowerCase().normalize('NFKC'),
      candidate
    ]));
    for (const seed of gscSeeds) {
      const key = seed.keyword.toLocaleLowerCase().normalize('NFKC');
      const existing = discoveredByKeyword.get(key);
      if (existing) {
        existing.rank = seed.rank;
        existing.rankingUrl = seed.rankingUrl;
        existing.sources = [...new Set([...existing.sources, ...seed.sources])];
      } else {
        discoveredByKeyword.set(key, {
          keyword: seed.keyword,
          searchVolume: 0,
          keywordDifficulty: null,
          intent: null,
          intentProbability: null,
          rank: seed.rank,
          rankingUrl: seed.rankingUrl,
          sources: seed.sources
        });
      }
    }
    const discovered = [...discoveredByKeyword.values()];
    const seedKey = keyword.toLocaleLowerCase().normalize('NFKC');
    const prioritized = discovered
      .sort((left, right) => {
        const leftSeed = left.keyword.toLocaleLowerCase().normalize('NFKC') === seedKey ? 1 : 0;
        const rightSeed = right.keyword.toLocaleLowerCase().normalize('NFKC') === seedKey ? 1 : 0;
        const leftGsc = left.sources.some((source) => source.startsWith('GSC_')) ? 1 : 0;
        const rightGsc = right.sources.some((source) => source.startsWith('GSC_')) ? 1 : 0;
        return rightSeed - leftSeed || rightGsc - leftGsc || right.searchVolume - left.searchVolume || left.keyword.localeCompare(right.keyword);
      })
      .slice(0, 12);
    const metrics = await dataForSeoProvider.scanKeywords({
      keywords: prioritized.map(({ keyword: candidateKeyword }) => candidateKeyword),
      languageCode: market.languageCode,
      locationCode: market.locationCode
    });
    scoredCandidates = prioritized.map((discovery, index) => scoreKeywordCandidate({
      discovery,
      metrics: metrics[index],
      seedKeyword: keyword!,
      businessCorpus: targetContext.content,
      pages: targetContext.pages
    })).sort((left, right) => left.score.expectedValueMicros === right.score.expectedValueMicros
      ? left.sourceKey.localeCompare(right.sourceKey)
      : left.score.expectedValueMicros > right.score.expectedValueMicros ? -1 : 1);
    const selectedCandidate = scoredCandidates.find(({ score }) => score.qualified) || scoredCandidates[0];
    if (!selectedCandidate) throw new Error('DataForSEO 没有返回可评分的候选机会');
    keyword = selectedCandidate.discovery.keyword;
  }
  const selectedCandidate = scoredCandidates.find(({ discovery }) => discovery.keyword === keyword);
  const fallbackPage = opportunity?.targetUrl
    ? targetContext.pages.find(({ url }) => url === opportunity?.targetUrl)
    : findCannibalizationMatch(keyword, targetContext.pages)?.page;
  const gscRankingUrl = selectedCandidate?.discovery.sources.some((source) => source.startsWith('GSC_'))
    ? selectedCandidate.discovery.rankingUrl
    : null;
  const gscTargetPage = gscRankingUrl
    ? targetContext.pages.find(({ url, resourceType }) => (resourceType === 'posts' || resourceType === 'pages') && comparableUrl(url) === comparableUrl(gscRankingUrl))
    : undefined;
  const cannibalized = gscTargetPage || selectedCandidate?.target?.page || fallbackPage;
  const relevantInternalLinks = selectRelevantInternalLinks(keyword, cannibalized?.title || keyword, targetContext.internalLinks.filter(({ url }) => url !== cannibalized?.url));
  const targetSnapshot = cannibalized
    ? await wordPressService.inspectTarget({ domain: run.site.domain, encrypted: run.site.wordpressCredentials, targetUrl: cannibalized.url, resourceType: cannibalized.resourceType === 'posts' || cannibalized.resourceType === 'pages' ? cannibalized.resourceType : undefined })
    : undefined;
  if (!opportunity) {
    if (!selectedCandidate) throw new Error('增长机会选择结果丢失');
    const metrics = selectedCandidate.metrics;
    opportunity = await workerPrisma.$transaction(async (tx) => {
      const snapshot = await tx.dataSnapshot.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        source: DataSource.DATAFORSEO,
        status: DataStatus.LIVE,
        formulaVersion: 'seo-opportunity-pool-4',
        fetchedAt: new Date(metrics.fetchedAt),
        payload: {
          seedKeyword: keyword,
          market,
          gscSnapshotId: latestGscSnapshot?.id || null,
          candidates: scoredCandidates.map((candidate) => ({
            discovery: candidate.discovery,
            metrics: candidate.metrics,
            qualified: candidate.score.qualified,
            reason: candidate.score.reason,
            expectedValueMicros: candidate.score.expectedValueMicros.toString(),
            formulaVersion: candidate.score.formulaVersion,
            targetUrl: candidate.target?.page.url || null
          }))
        } as unknown as Prisma.InputJsonValue
      } });
      const scan = await tx.keywordScan.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        snapshotId: snapshot.id,
        seedKeyword: keyword!,
        languageCode: market.languageCode,
        locationCode: market.locationCode,
        status: JobStatus.SUCCEEDED,
        resultCount: scoredCandidates.length,
        completedAt: new Date()
      } });
      const createdCandidates = [];
      for (const candidate of scoredCandidates) {
        const volume = BigInt(Math.max(0, candidate.metrics.searchVolume));
        createdCandidates.push(await tx.opportunity.create({ data: {
          organizationId: run!.organizationId,
          siteId: run!.siteId,
          keywordScanId: scan.id,
          snapshotId: snapshot.id,
          siteSnapshotId,
          sourceKey: `run:${run!.id}:${candidate.sourceKey}`,
          type: candidate.target ? 'EXISTING_PAGE' : run!.program.inputType === 'COMPETITOR_SITE' ? 'COMPETITOR_GAP' : run!.program.inputType === 'REFERENCE_URL' ? 'CONTENT_GAP' : 'KGR',
          title: candidate.discovery.keyword,
          targetUrl: candidate.target?.page.url,
          keyword: candidate.discovery.keyword,
          searchVolume: candidate.metrics.searchVolume,
          keywordDifficulty: candidate.metrics.keywordDifficulty,
          allintitleCount: candidate.metrics.allintitleCount,
          kgrNumerator: BigInt(candidate.metrics.allintitleCount),
          kgrDenominator: volume,
          roiScoreMicros: candidate.score.expectedValueMicros,
          trafficPotentialMicros: candidate.score.trafficPotentialMicros,
          businessRelevanceMicros: candidate.score.businessRelevanceMicros,
          successProbabilityMicros: candidate.score.successProbabilityMicros,
          confidenceMicros: candidate.score.confidenceMicros,
          executionCostMicros: candidate.score.executionCostMicros,
          riskPenaltyMicros: candidate.score.riskPenaltyMicros,
          expectedValueMicros: candidate.score.expectedValueMicros,
          formulaVersion: candidate.score.formulaVersion,
          evidence: { source: 'DATAFORSEO', snapshotId: snapshot.id, inputType: run!.program.inputType, market, discovery: candidate.discovery, qualified: candidate.score.qualified, reason: candidate.score.reason, cannibalizationTarget: candidate.target || null } as unknown as Prisma.InputJsonValue
        }, include: { snapshot: true } }));
      }
      const created = createdCandidates.find((candidate) => candidate.keyword === keyword);
      if (!created) throw new Error('已评分机会未能持久化');
      const qualification = selectedCandidate.score;
      if (!qualification.qualified) {
        for (let index = 0; index < createdCandidates.length; index += 1) {
          const candidate = createdCandidates[index];
          const evidence = candidate.evidence as { reason?: string; qualified?: boolean };
          await tx.growthDecision.create({ data: {
            organizationId: run!.organizationId,
            siteId: run!.siteId,
            runId: run!.id,
            opportunityId: candidate.id,
            status: 'REJECTED',
            rank: index + 1,
            scoreMicros: candidate.expectedValueMicros || 0n,
            scoreVersion: 'growth-decision-4',
            rationale: {
              rejectedBecause: evidence.reason || '数据置信度、预期价值或风险门禁未达标',
              inputType: run!.program.inputType,
              qualified: evidence.qualified === true
            }
          } });
        }
        await billingService.releaseCreditHold(tx, jobRunId);
        await completeStage(tx, {
          runId: run!.id,
          stage: GrowthRunStageCode.DISCOVER,
          summary: `真实数据已采集，但本轮没有合格机会：${qualification.reason}。不执行、不扣费。`,
          processedCount: scoredCandidates.length,
          totalCount: scoredCandidates.length,
          evidence: [{ type: 'DATAFORSEO_SNAPSHOT', snapshotId: snapshot.id, fetchedAt: metrics.fetchedAt, qualified: false, reason: qualification.reason }]
        });
        await tx.growthRunStage.updateMany({ where: { runId: run!.id, stage: { in: [GrowthRunStageCode.DECIDE, GrowthRunStageCode.EXECUTE, GrowthRunStageCode.LEARN] } }, data: { status: GrowthRunStageStatus.SKIPPED, summary: '没有合格机会，本阶段未执行。', processedCount: 0, totalCount: 0, finishedAt: new Date() } });
        await tx.growthRun.update({ where: { id: run!.id }, data: { resolvedKeyword: keyword, opportunityId: created.id, status: GrowthRunStatus.BLOCKED, errorCode: 'NO_QUALIFIED_OPPORTUNITY', errorMessage: qualification.reason, finishedAt: new Date(), delivery: { skipped: true, charged: false, reason: qualification.reason, snapshotId: snapshot.id } } });
        await tx.growthProgram.update({ where: { id: run!.programId }, data: { status: run!.program.mode === GrowthProgramMode.ONCE ? GrowthProgramStatus.COMPLETED : GrowthProgramStatus.ACTIVE, lastRunAt: new Date(), lastError: null } });
        await tx.auditEvent.create({ data: { organizationId: run!.organizationId, action: 'GROWTH_RUN_SKIPPED', targetType: 'growth_run', targetId: run!.id, metadata: { reason: qualification.reason, charged: false, snapshotId: snapshot.id } } });
        return null;
      }
      await tx.growthRun.update({ where: { id: run!.id }, data: { resolvedKeyword: keyword, opportunityId: created.id, targetUrl: cannibalized?.url } });
      await completeStage(tx, {
        runId: run!.id,
        stage: GrowthRunStageCode.DISCOVER,
        summary: cannibalized ? `已评估 ${scoredCandidates.length} 个真实候选，选择更新站内已有同主题页面，避免新建页面造成关键词蚕食。` : `已评估 ${scoredCandidates.length} 个真实候选，并按业务相关性、意图、站点匹配、数据置信度、成本和风险选择机会。`,
        processedCount: scoredCandidates.length,
        totalCount: scoredCandidates.length,
        evidence: [{ type: 'DATAFORSEO_SNAPSHOT', snapshotId: snapshot.id, fetchedAt: metrics.fetchedAt, market, candidateCount: scoredCandidates.length }, ...(latestGscSnapshot ? [{ type: 'GSC_OPPORTUNITY_SIGNALS', snapshotId: latestGscSnapshot.id, candidateCount: gscSignalCount }] : []), ...(cannibalized ? [{ type: 'CANNIBALIZATION', url: cannibalized.url, title: cannibalized.title }] : [])]
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!opportunity) return run.id;
  }

  await startStage(run.id, GrowthRunStageCode.DECIDE);
  let action = await workerPrisma.growthAction.findFirst({ where: { runId: run.id } });
  if (!action) {
    const opportunitySnapshotPayload = recordValue(opportunity.snapshot.payload);
    const capturedGscSnapshotId = opportunitySnapshotPayload.gscSnapshotId;
    const gscSnapshot = typeof capturedGscSnapshotId === 'string'
      ? await workerPrisma.dataSnapshot.findFirst({ where: { id: capturedGscSnapshotId, organizationId: run.organizationId, siteId: run.siteId, source: DataSource.GSC } })
      : Object.prototype.hasOwnProperty.call(opportunitySnapshotPayload, 'gscSnapshotId')
        ? null
        : latestGscSnapshot;
    const selection = selectGrowthAction({
      robotsBlocksAll: health.robots.blocksAll,
      target: targetSnapshot ? { contentLength: targetSnapshot.contentLength, modifiedAt: targetSnapshot.modifiedAt } : undefined,
      targetUrl: cannibalized?.url,
      gscRows: readGscRows(gscSnapshot?.payload),
      relevantInternalLinkCount: relevantInternalLinks.length,
      contentCoverage: cannibalized ? contentCoverageScore(keyword, cannibalized) : undefined
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
    const [candidateOpportunities, learningSamples] = await Promise.all([
      workerPrisma.opportunity.findMany({
        where: { siteId: run.siteId, sourceKey: { startsWith: `run:${run.id}:` } },
        orderBy: [{ expectedValueMicros: 'desc' }, { createdAt: 'asc' }]
      }),
      workerPrisma.measurementSample.findMany({
        where: { siteId: run.siteId, action: { type: actionType }, windowDays: 56 },
        select: { outcome: true },
        orderBy: { observedAt: 'desc' },
        take: 12
      })
    ]);
    const learnedExpectedValue = applyObservedActionMultiplier(opportunity.expectedValueMicros || 0n, learningSamples);
    action = await workerPrisma.$transaction(async (tx) => {
      let selectedDecisionId: string | undefined;
      for (let index = 0; index < candidateOpportunities.length; index += 1) {
        const candidate = candidateOpportunities[index];
        const selected = candidate.id === opportunity!.id;
        const decision = await tx.growthDecision.create({ data: {
          organizationId: run!.organizationId,
          siteId: run!.siteId,
          runId: run!.id,
          opportunityId: candidate.id,
          status: selected ? 'SELECTED' : 'DEFERRED',
          rank: index + 1,
          scoreMicros: selected ? learnedExpectedValue : candidate.expectedValueMicros || 0n,
          scoreVersion: 'growth-decision-4',
          rationale: selected
            ? { selectedBecause: selection.reason, inputType: run!.program.inputType, gscSnapshotId: gscSnapshot?.id || null, learningSampleCount: learningSamples.length, baseExpectedValueMicros: (candidate.expectedValueMicros || 0n).toString(), learnedExpectedValueMicros: learnedExpectedValue.toString() }
            : { rejectedBecause: (candidate.evidence as { reason?: string }).reason || '本轮只执行预期价值最高且风险可控的一项动作', inputType: run!.program.inputType },
          selectedActionType: selected ? actionType : undefined
        } });
        if (selected) selectedDecisionId = decision.id;
      }
      if (!selectedDecisionId) throw new Error('选中机会缺少决策记录');
      const created = await tx.growthAction.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        runId: run!.id,
        decisionId: selectedDecisionId,
        opportunityId: opportunity!.id,
        type: actionType,
        status: GrowthActionStatus.PLANNED,
        riskLevel: selection.riskLevel,
        autonomyDecision: actionType === GrowthActionType.DIAGNOSE_ONLY || canAutoPublish ? GrowthAutonomyDecision.AUTO_EXECUTE : GrowthAutonomyDecision.REQUIRE_REVIEW,
        targetUrl: cannibalized?.url,
        reversible: true,
        expectedValueMicros: learnedExpectedValue,
        plan: { action: actionType, keyword, targetUrl: cannibalized?.url || null, source: 'DETERMINISTIC_POLICY_V4', selectedBecause: selection.reason, mutatesWordPress: selection.mutatesWordPress, observationWindowsDays: [14, 28, 56], opportunityScoreVersion: opportunity!.formulaVersion },
        cooldownUntil: cannibalized ? new Date(Date.now() + 56 * day) : undefined
      } });
      await tx.actionEvidence.createMany({ data: [
        { organizationId: run!.organizationId, siteId: run!.siteId, actionId: created.id, type: 'SITE_SNAPSHOT', sourceRef: siteSnapshotId, payload: { siteSnapshotId, corpusChecksum: targetContext.checksum, pageCount: targetContext.pages.length } },
        { organizationId: run!.organizationId, siteId: run!.siteId, actionId: created.id, type: 'SEARCH_OPPORTUNITY', sourceRef: opportunity!.snapshotId, payload: { opportunityId: opportunity!.id, snapshotId: opportunity!.snapshotId, formulaVersion: opportunity!.formulaVersion, expectedValueMicros: learnedExpectedValue.toString(), selectedBecause: selection.reason } }
      ] });
      await tx.growthRun.update({ where: { id: run!.id }, data: { selectedActionType: actionType, targetUrl: cannibalized?.url } });
      await completeStage(tx, {
        runId: run!.id,
        stage: GrowthRunStageCode.DECIDE,
        summary: `已选择最小有效动作：${actionType}。${selection.reason}`,
        processedCount: candidateOpportunities.length,
        totalCount: candidateOpportunities.length,
        evidence: [{ type: 'ACTION_DECISION', actionId: created.id, action: actionType, autonomy: created.autonomyDecision, reversible: true, candidateCount: candidateOpportunities.length, learnedExpectedValueMicros: learnedExpectedValue.toString() }]
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
  const opportunityEvidence = opportunity.evidence as { discovery?: { intent?: string | null } };
  const brief = await contentAi.createBrief({
    keyword,
    language: run.site.language,
    searchIntent: opportunityEvidence.discovery?.intent || null,
    seoSnapshot: opportunity.snapshot.payload,
    knowledge: knowledgeInput,
    internalLinks: relevantInternalLinks
  });
  const allowedSourceTitles = knowledgeInput.map(({ title }) => title);
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
    const linked = insertContextualInternalLinks(beforeSnapshot!.content, relevantInternalLinks);
    generated = {
      title: beforeSnapshot!.title,
      slug: beforeSnapshot!.slug,
      html: linked.html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'ADD_INTERNAL_LINKS', title: beforeSnapshot!.title, html: linked.html, beforeHtml: beforeSnapshot!.content, insertedInternalLinks: linked.inserted.length }), internalLinks: { inserted: linked.inserted.length, items: linked.inserted } }
    };
  } else if (action.type === GrowthActionType.ADD_CONTENT_SECTION) {
    const section = await contentAi.generateSection({ keyword, language: run.site.language, currentTitle: beforeSnapshot!.title, currentHtml: beforeSnapshot!.content, seoSnapshot: opportunity.snapshot.payload, knowledge: knowledgeInput, brief });
    const html = `${beforeSnapshot!.content}${section.html}`;
    const originality = externalSource ? assessSourceOriginality(section.html, externalSource.content) : undefined;
    generated = {
      title: beforeSnapshot!.title,
      slug: beforeSnapshot!.slug,
      html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'ADD_CONTENT_SECTION', title: beforeSnapshot!.title, html, beforeHtml: beforeSnapshot!.content, originality, claimSources: section.claimSources, allowedSourceTitles, forbiddenClaims: brief.forbiddenClaims }), addedSection: section.heading, brief, coverageTopics: section.coverageTopics, claimSources: section.claimSources }
    };
  } else if (action.type === GrowthActionType.CONTENT_REFRESH) {
    const refreshed = await contentAi.refreshContent({ keyword, language: run.site.language, currentTitle: beforeSnapshot!.title, currentHtml: beforeSnapshot!.content, seoSnapshot: opportunity.snapshot.payload, knowledge: knowledgeInput, brief });
    const originality = externalSource ? assessSourceOriginality(refreshed.html, externalSource.content) : undefined;
    generated = {
      title: beforeSnapshot!.title,
      slug: beforeSnapshot!.slug,
      html: refreshed.html,
      qualityReport: {
        ...deterministicActionQualityGate({ actionType: 'CONTENT_REFRESH', title: beforeSnapshot!.title, html: refreshed.html, beforeHtml: beforeSnapshot!.content, originality, requiredTopics: brief.requiredTopics, declaredCoveredTopics: refreshed.coverageTopics, claimSources: refreshed.claimSources, allowedSourceTitles, forbiddenClaims: brief.forbiddenClaims }),
        brief,
        coverageTopics: refreshed.coverageTopics,
        claimSources: refreshed.claimSources,
        changeSummary: refreshed.changeSummary
      }
    };
  } else {
    const article = await contentAi.generate({
      keyword,
      language: run.site.language,
      seoSnapshot: opportunity.snapshot.payload,
      knowledge: knowledgeInput,
      brief,
      internalLinks: relevantInternalLinks
    });
    const linked = insertContextualInternalLinks(article.html, brief.internalLinkTargets);
    const originality = externalSource ? assessSourceOriginality(linked.html, externalSource.content) : undefined;
    const siteDuplication = targetContext.pages
      .filter(({ url }) => url !== beforeSnapshot?.url)
      .map(({ content }) => assessSourceOriginality(linked.html, content))
      .sort((left, right) => right.overlapRatio - left.overlapRatio)[0];
    generated = {
      title: article.title,
      slug: article.slug,
      html: linked.html,
      qualityReport: { ...deterministicActionQualityGate({ actionType: 'CREATE_CONTENT', title: article.title, html: linked.html, originality, siteDuplication, requiredTopics: brief.requiredTopics, declaredCoveredTopics: article.coverageTopics, claimSources: article.claimSources, allowedSourceTitles, forbiddenClaims: brief.forbiddenClaims }), internalLinks: { inserted: linked.inserted.length, items: linked.inserted }, brief, claimSources: article.claimSources }
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
    if (beforeSnapshot) {
      await tx.pageVersion.create({ data: {
        organizationId: run!.organizationId,
        siteId: run!.siteId,
        actionId: action!.id,
        kind: PageVersionKind.BEFORE,
        remotePostId: beforeSnapshot.postId,
        resourceType: beforeSnapshot.resourceType,
        url: beforeSnapshot.url,
        title: beforeSnapshot.title,
        content: beforeSnapshot.content,
        contentChecksum: beforeSnapshot.contentChecksum,
        remoteModifiedAt: wordPressDate(beforeSnapshot.modifiedAt)
      } });
    }
    await tx.actionEvidence.createMany({ data: [
      { organizationId: run!.organizationId, siteId: run!.siteId, actionId: action!.id, type: 'CONTENT_BRIEF', sourceRef: opportunity!.snapshot.id, payload: brief as Prisma.InputJsonValue },
      { organizationId: run!.organizationId, siteId: run!.siteId, actionId: action!.id, type: 'QUALITY_GATE', sourceRef: generated.qualityReport.version, payload: generated.qualityReport as Prisma.InputJsonValue }
    ] });
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
  if (!action || !draft || !action.site.wordpressCredentials) throw new Error('草稿或 WordPress 发布门禁不可用');
  if (draft.status === DraftStatus.PUBLISHED && draft.remotePostId && draft.publishedUrl) return draft.id;
  if (draft.status !== DraftStatus.PUBLISHING) throw new Error('草稿不处于可发布状态');
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
  const leaseToken = await acquireSiteMutationLease({ organizationId: job.organizationId, siteId: action.siteId, runId: action.runId, actionId: action.id });
  try {
    let published: { postId: string; url: string; snapshot?: WordPressEditableSnapshot };
    if (action.type === GrowthActionType.CREATE_CONTENT) {
      published = await wordPressService.publish({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, title: draft.title, slug: draft.slug, html: draft.html, deliveryId: draft.id });
      published.snapshot = await wordPressService.inspectTarget({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, targetUrl: published.url, resourceType: 'posts' });
    } else {
      const snapshot = action.beforeSnapshot as unknown as WordPressEditableSnapshot | null;
      if (!snapshot?.postId || !snapshot.resourceType || !snapshot.content) throw new Error('更新动作缺少可恢复的 WordPress 原始版本');
      published = await wordPressService.update({ domain: action.site.domain, encrypted: action.site.wordpressCredentials, snapshot, title: draft.title, html: draft.html, deliveryId: draft.id });
    }
    if (!published.snapshot) throw new Error('WordPress 写入完成后未能读取真实页面版本');
    await workerPrisma.$transaction(async (tx) => {
    const now = new Date();
    const gscConnection = await tx.integrationConnection.findFirst({ where: { organizationId: job.organizationId, siteId: action.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED } });
    await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.PUBLISHED, remotePostId: published.postId, publishedUrl: published.url } });
    await tx.publishAttempt.updateMany({ where: { jobRunId }, data: { status: PublishAttemptStatus.SUCCEEDED, remotePostId: published.postId, remoteUrl: published.url, finishedAt: now } });
    await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.OBSERVING, targetUrl: published.url, executedAt: now, verifiedAt: now, afterSnapshot: published.snapshot as unknown as Prisma.InputJsonValue, observationStartsAt: now, observeUntil: new Date(now.getTime() + 56 * day) } });
    await tx.pageVersion.create({ data: {
      organizationId: job.organizationId,
      siteId: action.siteId,
      actionId: action.id,
      kind: PageVersionKind.AFTER,
      remotePostId: published.snapshot.postId,
      resourceType: published.snapshot.resourceType,
      url: published.snapshot.url,
      title: published.snapshot.title,
      content: published.snapshot.content,
      contentChecksum: published.snapshot.contentChecksum,
      remoteModifiedAt: wordPressDate(published.snapshot.modifiedAt)
    } });
    await tx.growthRun.update({ where: { id: action.runId }, data: { status: GrowthRunStatus.DELIVERED, currentStage: GrowthRunStageCode.LEARN, targetUrl: published.url, deliveredAt: now, finishedAt: now, delivery: { draftId: draft.id, actionId: action.id, publishedUrl: published.url, remotePostId: published.postId, deliveredAt: now.toISOString() } } });
    await tx.growthRunStage.update({ where: { runId_stage: { runId: action.runId, stage: GrowthRunStageCode.LEARN } }, data: { status: GrowthRunStageStatus.RUNNING, startedAt: now, summary: gscConnection ? '已交付；等待 14/28/56 天真实 GSC 观察窗口。' : '已交付；未连接 GSC，仅验证页面可访问性与 Sitemap 发现线索。', evidence: [{ type: 'WORDPRESS_DELIVERY', url: published.url, deliveredAt: now.toISOString() }] } });
    await tx.growthProgram.update({ where: { id: action.run.programId }, data: { status: action.run.program.mode === GrowthProgramMode.ONCE ? GrowthProgramStatus.COMPLETED : GrowthProgramStatus.ACTIVE, deliveredRunCount: { increment: 1 }, lastRunAt: now, lastError: null } });
    await jobService.create(tx, { organizationId: job.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `growth-indexing:${action.id}:1`, payload: { draftId: draft.id, growthRunId: action.runId, actionId: action.id, observationNumber: 1 }, availableAt: new Date(now.getTime() + 60 * 60_000) });
    if (gscConnection) {
      for (const windowDays of [14, 28, 56] as const) {
        await jobService.create(tx, { organizationId: job.organizationId, type: JobType.GROWTH_MEASURE, idempotencyKey: `growth-measure:${action.id}:${windowDays}`, payload: { growthRunId: action.runId, actionId: action.id, windowDays }, availableAt: actionMeasurementWindow(now, windowDays).readyAt });
      }
    }
    await tx.auditEvent.create({ data: { organizationId: job.organizationId, action: 'GROWTH_ACTION_PUBLISHED', targetType: 'growth_action', targetId: action.id, metadata: { ...published, type: action.type, gscObservationScheduled: Boolean(gscConnection) } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return draft.id;
  } finally {
    await releaseSiteMutationLease(action.siteId, leaseToken);
  }
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
      const sample = await tx.measurementSample.findUnique({ where: { actionId_source_windowDays: { actionId: payload.actionId!, source: MeasurementSource.LEADING_INDICATORS, windowDays: 7 } } });
      if (!sample) await tx.measurementSample.create({ data: {
          organizationId: job.organizationId,
          siteId: draft.siteId,
          actionId: payload.actionId!,
          source: MeasurementSource.LEADING_INDICATORS,
          windowDays: 7,
          baseline: { source: 'UNAVAILABLE', trafficVerified: false },
          measurement: { pageAccessible: true, sitemapPresent, trafficVerified: false, note: 'Sitemap presence is not proof of indexing' },
          confidenceMicros: 0n,
          outcome: 'INCONCLUSIVE'
        } });
    } else if (!finalLeadingObservation) {
      await jobService.create(tx, { organizationId: job.organizationId, type: JobType.INDEXING_MONITOR, idempotencyKey: `growth-indexing:${payload.actionId}:${observationNumber + 1}`, payload: { ...payload, observationNumber: observationNumber + 1 }, availableAt: new Date(Date.now() + day) });
    }
    return observation.id;
  });
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
  const windowDays = payload.windowDays as 14 | 28 | 56;
  const existingSample = await workerPrisma.measurementSample.findUnique({ where: { actionId_source_windowDays: { actionId: payload.actionId, source: MeasurementSource.GSC, windowDays } } });
  if (existingSample) return `${payload.actionId}:${windowDays}:${existingSample.id}`;
  const action = await workerPrisma.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId }, include: { run: true, site: { include: { integrations: { where: { provider: 'GSC', status: SiteConnectionStatus.CONNECTED }, take: 1 } } } } });
  const connection = action?.site.integrations[0];
  if (!action || !connection?.propertyId || !action.executedAt || !action.targetUrl) throw new Error('GSC 观察连接、动作时间或精确目标 URL 不可用');
  const credentials = decryptSecret<{ refreshToken: string }>(Buffer.from(connection.encryptedCredentials));
  const window = actionMeasurementWindow(action.executedAt, windowDays);
  const [current, previous] = await Promise.all([
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.current }),
    gscProvider.sync({ refreshToken: credentials.refreshToken, propertyId: connection.propertyId, ...window.previous })
  ]);
  const siteUrl = new URL(/^https?:\/\//i.test(action.site.domain) ? action.site.domain : 'https://' + action.site.domain);
  const brandTerms = [action.site.name, siteUrl.hostname.replace(/^www\./, '').split('.')[0]];
  const currentMetrics = aggregateTargetGsc(readGscRows({ rows: current.rows }), action.targetUrl, brandTerms);
  const previousMetrics = aggregateTargetGsc(readGscRows({ rows: previous.rows }), action.targetUrl, brandTerms);
  const evaluation = evaluateGrowthOutcome(currentMetrics, previousMetrics);
  const enoughData = evaluation.outcome !== 'INCONCLUSIVE';
  return workerPrisma.$transaction(async (tx) => {
    const previousSnapshot = await tx.dataSnapshot.create({ data: { organizationId: job.organizationId, siteId: action.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.previous.startDate}T00:00:00Z`), periodEnd: new Date(`${window.previous.endDate}T00:00:00Z`), payload: gscSnapshotPayload(window.previous, readGscRows({ rows: previous.rows })) } });
    const snapshot = await tx.dataSnapshot.create({ data: { organizationId: job.organizationId, siteId: action.siteId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), periodStart: new Date(`${window.current.startDate}T00:00:00Z`), periodEnd: new Date(`${window.current.endDate}T00:00:00Z`), comparisonSnapshotId: previousSnapshot.id, payload: gscSnapshotPayload(window.current, readGscRows({ rows: current.rows })) } });
    const observation = await tx.measurementSample.create({ data: {
      organizationId: job.organizationId,
      siteId: action.siteId,
      actionId: action.id,
      source: MeasurementSource.GSC,
      windowDays,
      sourceSnapshotId: snapshot.id,
      baseline: { period: window.previous, metrics: previousMetrics },
      measurement: { period: window.current, metrics: currentMetrics, clickDelta: evaluation.clickDelta, statement: 'Observed change after the action; not asserted as absolute causation', excludesBrandQueries: true, targetUrl: action.targetUrl },
      observedClickDeltaMicros: BigInt(Math.round(evaluation.clickDelta * 1_000_000)),
      confidenceMicros: evaluation.confidenceMicros,
      outcome: evaluation.outcome
    } });
    await tx.growthRun.update({ where: { id: payload.growthRunId! }, data: { observation: { source: 'GSC', windowDays, current: currentMetrics, previous: previousMetrics, clickDelta: evaluation.clickDelta, outcome: evaluation.outcome, enoughData, causalClaim: false, targetUrl: action.targetUrl } } });
    if (payload.windowDays === 56) {
      await tx.growthRunStage.update({ where: { runId_stage: { runId: payload.growthRunId!, stage: GrowthRunStageCode.LEARN } }, data: { status: GrowthRunStageStatus.COMPLETED, summary: enoughData ? `已完成 56 天 GSC 观察：行动后非品牌自然点击变化 ${evaluation.clickDelta >= 0 ? '+' : ''}${evaluation.clickDelta}。` : '56 天窗口仍无足够页面级非品牌 GSC 数据，不生成增长结论。', processedCount: 3, totalCount: 3, finishedAt: new Date(), evidence: [{ type: 'GSC_OBSERVATION', measurementSampleId: observation.id, snapshotId: snapshot.id, windowDays: 56, outcome: evaluation.outcome, causalClaim: false }] } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.SUCCEEDED, verifiedAt: new Date() } });
      await tx.growthProgram.update({ where: { id: action.run.programId }, data: evaluation.outcome === 'WIN'
        ? { consecutiveWins: { increment: 1 } }
        : evaluation.outcome === 'LOSS' || evaluation.outcome === 'NEUTRAL' ? { consecutiveWins: 0 } : {} });
    }
    return `${action.id}:${windowDays}:${observation.id}`;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

const processWordPressRollback = async (jobRunId: string): Promise<string> => {
  const job = await workerPrisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const payload = job.payload as { draftId?: string; actionId?: string };
  if (!payload.draftId) throw new Error('回滚任务缺少 draftId');
  const draft = await workerPrisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: job.organizationId }, include: { site: true } });
  const action = payload.actionId ? await workerPrisma.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId }, include: { pageVersions: true } }) : null;
  if (!draft?.site.wordpressCredentials || !draft.remotePostId) throw new Error('没有可回滚的 WordPress 交付');
  if (draft.status === DraftStatus.ROLLED_BACK) return draft.id;
  if (!action) throw new Error('回滚任务缺少增长动作');
  const leaseToken = await acquireSiteMutationLease({ organizationId: job.organizationId, siteId: action.siteId, runId: action.runId, actionId: action.id });
  try {
    let restored: WordPressEditableSnapshot | undefined;
    if (action.type !== GrowthActionType.CREATE_CONTENT) {
      const snapshot = action.beforeSnapshot as unknown as WordPressEditableSnapshot | null;
      const afterVersion = action.pageVersions.find(({ kind }) => kind === PageVersionKind.AFTER);
      const expectedCurrent = action.afterSnapshot as unknown as WordPressEditableSnapshot | null;
      if (!snapshot?.postId || !snapshot.content || !afterVersion || !expectedCurrent?.contentChecksum) throw new Error('更新动作缺少原始或交付后 WordPress 版本');
      const current = await wordPressService.inspectTarget({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, targetUrl: snapshot.url, resourceType: snapshot.resourceType });
      if (current.contentChecksum === snapshot.contentChecksum && current.title === snapshot.title) {
        restored = current;
      } else {
        restored = await wordPressService.restore({
          domain: draft.site.domain,
          encrypted: draft.site.wordpressCredentials,
          snapshot,
          expectedCurrent
        });
      }
    } else {
      await wordPressService.rollback({ domain: draft.site.domain, encrypted: draft.site.wordpressCredentials, postId: draft.remotePostId });
    }
    await workerPrisma.$transaction(async (tx) => {
      await tx.contentDraft.update({ where: { id: draft.id }, data: { status: DraftStatus.ROLLED_BACK } });
      await tx.publishAttempt.updateMany({ where: { draftId: draft.id, status: PublishAttemptStatus.SUCCEEDED }, data: { status: PublishAttemptStatus.ROLLED_BACK } });
      await tx.growthAction.update({ where: { id: action.id }, data: { status: GrowthActionStatus.ROLLED_BACK, rolledBackAt: new Date() } });
      if (restored && !action.pageVersions.some(({ kind }) => kind === PageVersionKind.ROLLBACK)) {
        await tx.pageVersion.create({ data: {
          organizationId: job.organizationId,
          siteId: action.siteId,
          actionId: action.id,
          kind: PageVersionKind.ROLLBACK,
          remotePostId: restored.postId,
          resourceType: restored.resourceType,
          url: restored.url,
          title: restored.title,
          content: restored.content,
          contentChecksum: restored.contentChecksum,
          remoteModifiedAt: wordPressDate(restored.modifiedAt)
        } });
      }
      await tx.auditEvent.create({ data: { organizationId: job.organizationId, action: 'GROWTH_ACTION_ROLLED_BACK', targetType: 'content_draft', targetId: draft.id, metadata: { actionId: action.id, restoredPreviousVersion: action.type !== GrowthActionType.CREATE_CONTENT } } });
    });
    return draft.id;
  } finally {
    await releaseSiteMutationLease(action.siteId, leaseToken);
  }
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
  if (connection.organizationId !== job.organizationId) throw new Error('GSC 连接与作业组织不匹配');
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
        const action = await tx.growthAction.findFirst({ where: { id: payload.actionId, organizationId: job.organizationId }, select: { siteId: true } });
        const windowDays = payload.windowDays === 14 || payload.windowDays === 28 || payload.windowDays === 56 ? payload.windowDays : null;
        if (action && windowDays) {
          const existing = await tx.measurementSample.findUnique({ where: { actionId_source_windowDays: { actionId: payload.actionId, source: MeasurementSource.GSC, windowDays } } });
          if (!existing) await tx.measurementSample.create({ data: {
            organizationId: job.organizationId,
            siteId: action.siteId,
            actionId: payload.actionId,
            source: MeasurementSource.GSC,
            windowDays,
            baseline: { available: false },
            measurement: { available: false, error: message.slice(0, 2_000) },
            confidenceMicros: 0n,
            outcome: 'INCONCLUSIVE'
          } });
        }
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

  if (capabilities.gsc) {
    const dueGscConnections = await workerPrisma.integrationConnection.findMany({
      where: {
        provider: 'GSC',
        status: SiteConnectionStatus.CONNECTED,
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - day) } }]
      },
      orderBy: [{ lastSyncedAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: { id: true, organizationId: true, siteId: true }
    });
    const end = new Date(Date.now() - 3 * day);
    const start = new Date(end.getTime() - 27 * day);
    for (const connection of dueGscConnections) {
      await workerPrisma.$transaction((tx) => jobService.create(tx, {
        organizationId: connection.organizationId,
        type: JobType.GSC_SYNC,
        idempotencyKey: `gsc-periodic:${connection.id}:${isoDate(end)}`,
        payload: {
          connectionId: connection.id,
          siteId: connection.siteId,
          startDate: isoDate(start),
          endDate: isoDate(end)
        }
      }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    }
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
        const gscConnected = await tx.integrationConnection.count({ where: { siteId: program.siteId, provider: 'GSC', status: SiteConnectionStatus.CONNECTED } }) > 0;
        const intervalDays = continuousCadenceDays(program.consecutiveWins, gscConnected);
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
