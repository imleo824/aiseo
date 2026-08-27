import { ITenantRepository } from '../domain/repository';
import { IWordPressPublisher, ISearchEngineSubmitter, IContentIntelligenceEngine } from '../domain/ports';
import { fileTenantRepository } from '../infrastructure/persistence/fileTenantRepository';
import { wordPressAdapter } from '../infrastructure/wordpress/wordpressAdapter';
import { searchEngineAdapter } from '../infrastructure/searchEngine/searchEngineAdapter';
import { geminiAdapter } from '../infrastructure/ai/geminiAdapter';
import { logger } from '../utils/logger';
import { ArticleDraft, Opportunity } from '../../src/types/seo';
import { sanitizeArticleHtml } from '../utils/contentSanitizer';
import { randomUUID } from 'crypto';
import { nextTaskRunAt } from '../utils/taskSchedule';
import { applySiteContentQualityGate } from './contentQualityGate';
import { publishingAdapterRouter, publishingProviderLabel } from '../infrastructure/publishing/publishingAdapterRouter';
import { weaveRelevantInternalLink } from './internalLinking';
import { hasExistingTopic } from './opportunitySafety';

const scheduledTopicForArticle = (baseTopic: string, ordinal: number, articleCount: number, language: string): string => {
  if (articleCount === 1) return baseTopic;
  const chineseAngles = ['核心原理与适用边界', '技术选型与实施方案', '效果验证与持续优化', '常见失败模式与修复'];
  const englishAngles = ['principles and scope', 'implementation and architecture', 'measurement and iteration', 'failure modes and remediation'];
  const angles = language === 'zh-CN' ? chineseAngles : englishAngles;
  return `${baseTopic}：${angles[(ordinal - 1) % angles.length]}`;
};

export class CronScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isRunningTick = false;

  constructor(
    private readonly repository: ITenantRepository = fileTenantRepository,
    private readonly wpPublisher: IWordPressPublisher = wordPressAdapter,
    private readonly searchEngineSubmitter: ISearchEngineSubmitter = searchEngineAdapter,
    private readonly aiEngine: IContentIntelligenceEngine = geminiAdapter
  ) {}

  public start(): void {
    if (this.timer) return;
    logger.info('SCHEDULER', '自动化后台调度引擎已启动 (周期: 30s 巡检)');
    void this.tick();
    this.timer = setInterval(() => this.tick(), 30000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('SCHEDULER', '自动化后台调度引擎已停止');
    }
  }

  public async runTaskImmediately(tenantId: string, taskId: string): Promise<boolean> {
    const tenantData = this.repository.getTenantData(tenantId);
    const task = tenantData.automatedTasks.find(t => t.id === taskId);
    if (!task) return false;

    return this.executeTask(tenantId, task);
  }

  private async tick(): Promise<void> {
    if (this.isRunningTick) return;
    this.isRunningTick = true;

    try {
      const targetTenants = this.repository.getAllTenantIds();
      if (!targetTenants.length) return;
      const now = new Date();

      for (const tenantId of targetTenants) {
        const tenantData = this.repository.getTenantData(tenantId);

        for (const task of tenantData.automatedTasks) {
          if (task.status !== 'ACTIVE') continue;

          const nextRun = task.nextRunAt ? new Date(task.nextRunAt) : null;
          if (!nextRun || now >= nextRun) {
            logger.info('SCHEDULER', `触发到期定时任务:「${task.taskName}」(ID: ${task.id})`, { tenantId });
            await this.executeTask(tenantId, task);
          }
        }
      }
    } catch (err: any) {
      logger.error('SCHEDULER', `Tick execution error: ${err?.message || err}`);
    } finally {
      this.isRunningTick = false;
    }
  }

  private async executeTask(tenantId: string, task: any): Promise<boolean> {
    const tenantData = this.repository.getTenantData(tenantId);
    const nowIso = new Date().toISOString();

    const targetSites = task.siteId === 'all'
      ? tenantData.sites
      : tenantData.sites.filter(s => task.siteId.split(',').includes(s.id));

    if (targetSites.length === 0) {
      logger.warn('SCHEDULER', `任务 ${task.id} 未找到对应的有效目标站点`, { tenantId });
      return false;
    }

    task.lastRunAt = nowIso;
    
    task.nextRunAt = nextTaskRunAt(task.scheduleType, task.scheduleTime, new Date()).toISOString();

    let successfulPublishes = 0;
    const articleCount = Math.max(1, Math.min(50, Number(task.articleCountPerRun) || 1));

    for (const site of targetSites) {
      for (let articleOrdinal = 1; articleOrdinal <= articleCount; articleOrdinal += 1) {
      let creditsDeducted = false;
      try {
        const baseKeyword = task.targetKeywordTopic || 'AI 架构与企业级自动化实践';
        const keyword = scheduledTopicForArticle(baseKeyword, articleOrdinal, articleCount, site.siteLanguage || 'zh-CN');
        if (hasExistingTopic(tenantData.opportunities || [], site.id, keyword)) {
          throw new Error(`“${keyword}”已在站点机会队列或已发布内容中；定时巡航不会重复生产相同搜索意图。`);
        }
        const articlePrompt = `${keyword}\n\n这是本次定时任务的第 ${articleOrdinal}/${articleCount} 篇。仅覆盖这个明确角度，避免与同批或已发布内容重复。`;
        const knowledgeSources = tenantData.knowledgeSources
          .filter((source) => source.siteId === site.id)
          .map((source) => `${source.title}: ${source.contentSnippet}`);
        if (!knowledgeSources.length) throw new Error('自动发布要求至少一条客户知识库或原创研究资料');
        if ('isConfigured' in this.aiEngine && typeof this.aiEngine.isConfigured === 'function' && !this.aiEngine.isConfigured()) {
          throw new Error('AI 服务尚未配置，自动任务未执行');
        }
        const publishingReadiness = publishingAdapterRouter.readiness(site);
        if (!publishingReadiness.ready) {
          throw new Error(publishingReadiness.reason || `${publishingProviderLabel(site)} 发布连接器不可用`);
        }

        // 0. Credit Check & Deduction (Dynamic pricing with fallback)
        if (typeof (this.repository as any).isActionEnabled === 'function' && !(this.repository as any).isActionEnabled('AUTOPILOT_CRUISE')) {
          logger.warn('SCHEDULER', `“定时巡航自动发文”功能已被系统管理员关闭，跳过任务 ${task.taskName}`, { tenantId });
          continue;
        }

        const cruiseCost = this.repository.getActionCost('AUTOPILOT_CRUISE', 20);
        const creditRes = await this.repository.consumeCredits(
          tenantId,
          cruiseCost,
          'AUTOPILOT_CRUISE',
          `定时巡航自动发文 (${task.taskName} -> ${site.name})`,
          { taskId: task.id, siteId: site.id, siteName: site.name, keyword }
        );

        if (!creditRes.success) {
          logger.warn('SCHEDULER', `租户 ${tenantId} 积分不足 (${creditRes.balance}/${cruiseCost})，跳过站点 ${site.name} 的定时发文`, { tenantId });
          await this.repository.appendAuditLog(tenantId, {
            id: `log-task-err-${Date.now()}`,
            siteId: site.id,
            timestamp: nowIso,
            actor: 'SYSTEM_AUTOPILOT',
            action: 'CRON_AUTO_PUBLISH',
            target: `${site.name} - ${task.taskName}`,
            result: 'WARNING',
            details: `定时任务执行跳过：账户积分不足 (需 ${cruiseCost} 积分，当前剩余 ${creditRes.balance} 积分)，请及时充值 USDT。`
          });
          break;
        }
        creditsDeducted = true;

        // Stages 1–3: turn the explicit task topic into a traceable intent
        // and a brief grounded in the customer's actual knowledge sources.
        const executionId = randomUUID();
        const oppId = `opp-task-${executionId}`;
        const demandAnalysis = await this.aiEngine.analyzeSearchDemand(keyword, site.siteLanguage || 'zh-CN', site.niche);
        const contentBrief = await this.aiEngine.generateContentBrief(
          oppId,
          keyword,
          site.siteLanguage || 'zh-CN',
          knowledgeSources
        );

        // Stage 4 uses the same visible brief; it must not silently re-plan.
        const articleResult = await this.aiEngine.generateArticleAndQualityCheck(
          articlePrompt,
          site.siteLanguage || 'zh-CN',
          contentBrief,
          knowledgeSources
        );
        articleResult.qualityGate = applySiteContentQualityGate(
          articleResult.qualityGate,
          articleResult.contentHtml,
          (tenantData.drafts || []).filter((draft) => draft.siteId === site.id && draft.status === 'PUBLISHED')
        );
        if (!articleResult.qualityGate.passed) {
          throw new Error(`质量门禁未通过（得分 ${articleResult.qualityGate.overallScore}），自动发布已阻止`);
        }

        // 2. Real publication through the connector declared by this site.
        const internalLinkResult = weaveRelevantInternalLink({
          contentHtml: sanitizeArticleHtml(articleResult.contentHtml),
          articleTitle: articleResult.title,
          targetKeyword: keyword,
          siteDomain: site.domain,
          publishedDrafts: (tenantData.drafts || []).filter((draft) => draft.siteId === site.id && draft.status === 'PUBLISHED')
        });
        const sanitizedContentHtml = sanitizeArticleHtml(internalLinkResult.contentHtml);
        const wpResult = await this.wpPublisher.publishPost(site, {
          title: articleResult.title,
          contentHtml: sanitizedContentHtml,
          summary: articleResult.summary,
          status: 'publish'
        });
        if (!wpResult.success || !wpResult.publishedUrl) {
          throw new Error(wpResult.error || `${publishingProviderLabel(site)} 发布未返回有效文章 URL`);
        }

        // 3. 收录监测：普通文章不能调用受限的 Google Indexing API；仅保留
        // 百度允许的主动推送，并由 canonical URL、站点地图和 GSC 后续监测 Google。
        let baiduResultMsg = '未配置百度主动推送';
        if (site.siteLanguage === 'zh-CN') {
          const bRes = await this.searchEngineSubmitter.pushToBaidu(site.domain, site.baiduToken, [wpResult.publishedUrl]);
          baiduResultMsg = bRes.message;

          if (bRes.success && !bRes.skipped) {
            await this.repository.appendBaiduLog(tenantId, {
              id: `baidu-${randomUUID()}`,
              url: wpResult.publishedUrl,
              submittedAt: nowIso,
              type: 'DAILY_API',
              status: 'SUBMITTED',
              remainQuota: bRes.remain || 0
            });
          }
        }

        const googleMonitoringMessage = '普通文章不调用 Google Indexing API；通过 canonical URL、站点地图与 GSC 监测发现状态';

        // Persist the evidence and planned brief with the published result.
        const newOpp: Opportunity = {
          id: oppId,
          siteId: site.id,
          title: demandAnalysis.suggestedTitle || articleResult.title,
          type: 'NEW_CONTENT',
          language: site.siteLanguage || 'zh-CN',
          targetKeyword: keyword,
          category: site.whitelistedCategories[0] || '默认分类',
          riskLevel: 'LOW',
          estimatedMonthlyVisitsGain: 0,
          demandEvidence: {
            sourceType: 'USER_SEED',
            queryOrTopic: keyword,
            evidenceDescription: '基于已配置的定时主题生成；GSC / DataForSEO 未接入时不提供搜索量、排名或流量预估。',
            reliabilityConfidence: 0
          },
          scoreBreakdown: {
            businessValue: 0,
            searchDemand: 0,
            winProbability: 0,
            currentRanking: 0,
            engagementPotential: 0,
            googleBaiduReuse: 0,
            internalLinkValue: 0,
            freshness: 0,
            dataReliability: 0,
            riskPenalty: 0,
            costPenalty: 0,
            totalScore: 0
          },
          status: 'AUTO_PUBLISHED',
          createdAt: nowIso,
          updatedAt: nowIso,
          contentBrief
        };

        const newDraft: ArticleDraft = {
          id: `draft-task-${executionId}`,
          opportunityId: oppId,
          siteId: site.id,
          title: articleResult.title,
          language: site.siteLanguage || 'zh-CN',
          category: site.whitelistedCategories[0] || '默认分类',
          summary: articleResult.summary,
          contentHtml: sanitizedContentHtml,
          sourcesUsed: knowledgeSources,
          qualityGate: articleResult.qualityGate,
          status: 'PUBLISHED',
          publishedUrl: wpResult.publishedUrl,
          publishedAt: nowIso,
          wpPostId: wpResult.wpPostId,
          createdAt: nowIso
        };

        await this.repository.saveOpportunity(tenantId, newOpp);
        await this.repository.saveDraft(tenantId, newDraft);

        task.totalArticles = (task.totalArticles || 0) + 1;
        site.currentWeeklyPublished = (site.currentWeeklyPublished || 0) + 1;
        site.pagesCount = (site.pagesCount || 0) + 1;
        await this.repository.saveSite(tenantId, site);
        successfulPublishes += 1;

        // 5. Append Audit Log
        await this.repository.appendAuditLog(tenantId, {
          id: `log-task-${executionId}`,
          siteId: site.id,
          timestamp: nowIso,
          actor: 'SYSTEM_AUTOPILOT',
          action: 'CRON_AUTO_PUBLISH',
          target: `${site.name} - ${articleResult.title}`,
          result: 'SUCCESS',
          details: `定时巡航已自动发布。内链：${internalLinkResult.decision.message}；百度：${baiduResultMsg}；Google：${googleMonitoringMessage}；URL: ${wpResult.publishedUrl}`
        });
      } catch (siteErr: any) {
        logger.error('SCHEDULER', `任务执行失败 (站点: ${site.name}): ${siteErr?.message}`, { tenantId });
        
        if (creditsDeducted) {
          try {
            const cruiseCost = this.repository.getActionCost('AUTOPILOT_CRUISE', 20);
            await this.repository.refundCredits(
              tenantId,
              cruiseCost,
              'AUTOPILOT_CRUISE',
              `定时巡航发文异常补偿退款 (${task.taskName} -> ${site.name})`,
              { taskId: task.id, siteId: site.id, articleOrdinal, error: siteErr?.message }
            );
          } catch (refundErr) {
            logger.error('SCHEDULER', `Failed to refund credits for tenant ${tenantId}`, refundErr);
          }
        }

        await this.repository.appendAuditLog(tenantId, {
          id: `log-task-fail-${randomUUID()}`,
          siteId: site.id,
          timestamp: nowIso,
          actor: 'SYSTEM_AUTOPILOT',
          action: 'CRON_AUTO_PUBLISH',
          target: `${site.name} - ${task.taskName}`,
          result: 'FAILED',
          details: `定时巡航执行失败: ${siteErr?.message || siteErr}${creditsDeducted ? '，扣除的积分已自动全额退还。' : '，失败发生在扣点前，未产生积分流水。'}`
        });
      }
      }
    }

    await this.repository.saveTask(tenantId, task);
    return successfulPublishes > 0;
  }
}

export const cronScheduler = new CronScheduler();
