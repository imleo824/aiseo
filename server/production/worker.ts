import { Worker, type Job } from 'bullmq';
import { DataSource, DataStatus, JobStatus, JobType, Prisma } from '@prisma/client';
import { billingService } from './billingService';
import { dataForSeoProvider, gscProvider, tronGridProvider, wordPressProvider } from './providers';
import { disconnectDatabase, prisma } from './prisma';
import { getQueueConnection, PRODUCTION_QUEUE, closeQueue } from './queue';
import { jobService } from './jobService';
import { logger } from '../utils/logger';
import { sanitizeArticleHtml } from '../utils/contentSanitizer';
import { geminiAdapter } from '../infrastructure/ai/geminiAdapter';

type QueuePayload = { jobRunId: string; providerTaskId?: string; pollCount?: number };

const markFailed = async (jobRunId: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const jobRun = await prisma.jobRun.findUnique({ where: { id: jobRunId } });
  await prisma.jobRun.update({ where: { id: jobRunId }, data: { status: JobStatus.FAILED, errorCode: 'JOB_EXECUTION_FAILED', errorMessage: message, finishedAt: new Date() } });
  if (jobRun?.type === JobType.DATAFORSEO_SERP) await billingService.releaseCreditHold(jobRunId);
};

const processGscSync = async (jobRunId: string) => {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: jobRunId } });
  const connection = await prisma.integrationConnection.findUnique({ where: { organizationId_provider: { organizationId: run.organizationId, provider: DataSource.GSC } } });
  if (!connection) throw new Error('GSC 尚未授权');
  const sync = await gscProvider.sync(connection);
  await prisma.$transaction([
    prisma.dataSnapshot.create({ data: { organizationId: run.organizationId, source: DataSource.GSC, status: DataStatus.LIVE, fetchedAt: new Date(), availableFrom: sync.availableFrom, payload: { rows: sync.rows, rowCount: sync.rows.length } as Prisma.InputJsonValue } }),
    prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: DataStatus.LIVE, lastSyncedAt: new Date(), lastError: null } })
  ]);
};

const processDataForSeo = async (queueJob: Job<QueuePayload>, runId: string) => {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { keyword?: string; locationCode?: number; languageCode?: string; siteId?: string };
  const providerTaskId = queueJob.data.providerTaskId;
  if (!providerTaskId) {
    if (!payload.keyword || !payload.locationCode || !payload.languageCode) throw new Error('DataForSEO 作业参数不完整');
    const taskId = await dataForSeoProvider.createSerpTask({ keyword: payload.keyword, locationCode: payload.locationCode, languageCode: payload.languageCode, tag: run.id });
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: JobStatus.QUEUED, result: { providerTaskId: taskId, status: 'PENDING' } } });
    await jobService.queueDataForSeoPoll(run.id, taskId, 0);
    return true;
  }
  const result = await dataForSeoProvider.getSerpTask(providerTaskId);
  if (!result.ready) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: JobStatus.QUEUED, result: { providerTaskId, status: 'PENDING' } } });
    await jobService.queueDataForSeoPoll(run.id, providerTaskId, (queueJob.data.pollCount || 0) + 1);
    return true;
  }
  await prisma.dataSnapshot.create({ data: { organizationId: run.organizationId, siteId: payload.siteId, source: DataSource.DATAFORSEO, status: DataStatus.LIVE, providerTaskId, payload: result.payload as object } });
  await billingService.settleCreditHold(run.id);
  return false;
};

const processPaymentVerification = async (runId: string) => {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { paymentIntentId?: string };
  if (!payload.paymentIntentId) throw new Error('支付核验作业缺少 paymentIntentId');
  const payment = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payload.paymentIntentId } });
  if (!payment.txHash) throw new Error('充值意图尚未提交交易哈希');
  const verification = await tronGridProvider.verifyTransfer({ txHash: payment.txHash, recipientAddress: payment.recipientAddress, expectedAmountMicros: payment.expectedAmountMicros });
  await billingService.creditVerifiedPayment(payment.id, verification as Prisma.InputJsonValue);
};

const processWordPressPublication = async (runId: string) => {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { draftId?: string };
  if (!payload.draftId) throw new Error('发布作业缺少 draftId');
  const draft = await prisma.contentDraft.findFirst({ where: { id: payload.draftId, organizationId: run.organizationId }, include: { site: true, approvals: true } });
  if (!draft || !draft.approvals.length) throw new Error('草稿尚未经过人工审批');
  if (!draft.site.wordpressCredentials) throw new Error('站点尚未配置 WordPress 应用密码');
  const publishedUrl = await wordPressProvider.publish({ domain: draft.site.domain, credentials: Buffer.from(draft.site.wordpressCredentials), title: draft.title, html: sanitizeArticleHtml(draft.html) });
  await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedUrl } });
};

const processContentGeneration = async (runId: string) => {
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  const payload = run.payload as { siteId?: string; keyword?: string; language?: string; dataSnapshotIds?: string[] };
  if (!payload.siteId || !payload.keyword || !Array.isArray(payload.dataSnapshotIds) || !payload.dataSnapshotIds.length) throw new Error('内容作业缺少站点、关键词或真实数据快照');
  const [site, snapshots] = await Promise.all([
    prisma.site.findFirst({ where: { id: payload.siteId, organizationId: run.organizationId } }),
    prisma.dataSnapshot.findMany({ where: { id: { in: payload.dataSnapshotIds }, organizationId: run.organizationId, status: DataStatus.LIVE } })
  ]);
  if (!site || snapshots.length !== payload.dataSnapshotIds.length) throw new Error('内容作业引用了不可用或跨组织的数据快照');
  const sourceNotes = snapshots.map((snapshot) => `${snapshot.source} snapshot ${snapshot.id} fetched ${snapshot.fetchedAt.toISOString()}`);
  const generated = await geminiAdapter.generateArticleAndQualityCheck(payload.keyword, payload.language || site.language, undefined, sourceNotes);
  const qualityReport = { ...generated.qualityGate, generatedAt: new Date().toISOString() };
  const provenance = snapshots.map((snapshot) => ({ source: snapshot.source, status: snapshot.status, fetchedAt: snapshot.fetchedAt.toISOString(), providerTaskId: snapshot.providerTaskId || undefined, availableFrom: snapshot.availableFrom?.toISOString() }));
  await prisma.contentDraft.create({ data: { organizationId: run.organizationId, siteId: site.id, status: generated.qualityGate.passed ? 'PENDING_REVIEW' : 'REJECTED', title: generated.title, html: sanitizeArticleHtml(generated.contentHtml), qualityReport, dataProvenance: provenance } });
};

export const createProductionWorker = () => new Worker<QueuePayload>(PRODUCTION_QUEUE, async (queueJob) => {
  const runId = queueJob.data.jobRunId;
  const run = await prisma.jobRun.findUniqueOrThrow({ where: { id: runId } });
  await prisma.jobRun.update({ where: { id: runId }, data: { status: JobStatus.RUNNING, attempts: { increment: 1 }, startedAt: new Date(), errorCode: null, errorMessage: null } });
  try {
    let deferred = false;
    switch (run.type) {
      case JobType.GSC_SYNC:
        await processGscSync(runId);
        break;
      case JobType.DATAFORSEO_SERP:
        deferred = await processDataForSeo(queueJob, runId);
        break;
      case JobType.PAYMENT_VERIFY:
        await processPaymentVerification(runId);
        break;
      case JobType.WORDPRESS_PUBLISH:
        await processWordPressPublication(runId);
        break;
      case JobType.CONTENT_GENERATION:
        await processContentGeneration(runId);
        break;
      default:
        throw new Error(`Worker does not support job type ${run.type}`);
    }
    if (!deferred) await prisma.jobRun.update({ where: { id: runId }, data: { status: JobStatus.SUCCEEDED, finishedAt: new Date() } });
  } catch (error) {
    await markFailed(runId, error);
    throw error;
  }
}, { connection: getQueueConnection(), concurrency: 5 });

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.cjs')) {
  const worker = createProductionWorker();
  worker.on('completed', (job) => logger.info('WORKER', `Job ${job.id} completed`));
  worker.on('failed', (job, error) => logger.error('WORKER', `Job ${job?.id} failed: ${error.message}`));
  const shutdown = async () => {
    await worker.close();
    await closeQueue();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
