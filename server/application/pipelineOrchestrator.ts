import { WordPressSite, Opportunity, ArticleDraft, QualityGateResult, Language } from '../../src/types/seo';
import { IWordPressPublisher, ISearchEngineSubmitter, IContentIntelligenceEngine } from '../domain/ports';
import { ITenantRepository, TenantData } from '../domain/repository';
import { eventBus } from '../domain/eventBus';
import { wordPressAdapter } from '../infrastructure/wordpress/wordpressAdapter';
import { searchEngineAdapter } from '../infrastructure/searchEngine/searchEngineAdapter';
import { geminiAdapter } from '../infrastructure/ai/geminiAdapter';
import { fileTenantRepository } from '../infrastructure/persistence/fileTenantRepository';
import { logger } from '../utils/logger';
import { NotFoundError, ValidationError } from '../domain/errors';
import { generateSeoSlug } from '../utils/validator';
import { sanitizeArticleHtml } from '../utils/contentSanitizer';
import { applySiteContentQualityGate } from './contentQualityGate';
import { publishingAdapterRouter, publishingProviderLabel } from '../infrastructure/publishing/publishingAdapterRouter';
import { weaveRelevantInternalLink } from './internalLinking';
import { hasExistingTopic } from './opportunitySafety';

export interface PipelineExecutionOptions {
  tenantId: string;
  siteId: string;
  keyword?: string;
  actor?: 'USER_ADMIN' | 'SYSTEM_AUTOPILOT' | 'POLICY_ENGINE';
  traceId?: string;
}

export interface PipelineExecutionResult {
  success: boolean;
  opportunity?: Opportunity;
  draft?: ArticleDraft;
  stagesCompleted: string[];
  executionTimeMs: number;
  error?: string;
}

export class SEOPipelineOrchestrator {
  constructor(
    private readonly wpPublisher: IWordPressPublisher = wordPressAdapter,
    private readonly searchEngineSubmitter: ISearchEngineSubmitter = searchEngineAdapter,
    private readonly aiEngine: IContentIntelligenceEngine = geminiAdapter,
    private readonly repository: ITenantRepository = fileTenantRepository
  ) {}

  public async executePipeline(options: PipelineExecutionOptions): Promise<PipelineExecutionResult> {
    const startTime = Date.now();
    const { tenantId, siteId, keyword, actor = 'SYSTEM_AUTOPILOT', traceId } = options;
    const stagesCompleted: string[] = [];
    let creditDeductedAmount = 0;

    const tenantData = this.repository.getTenantData(tenantId);
    const site = tenantData.sites.find(s => s.id === siteId);

    if (!site) {
      throw new NotFoundError(`Site '${siteId}' was not found in tenant '${tenantId}'.`);
    }
    const publishingReadiness = publishingAdapterRouter.readiness(site);
    if (!publishingReadiness.ready) {
      throw new ValidationError(publishingReadiness.reason || `${publishingProviderLabel(site)} 发布连接器不可用`);
    }

    const profiler = logger.profile('ORCHESTRATOR', `executePipeline(site: ${site.domain}, keyword: ${keyword || 'AUTO'})`, {
      traceId,
      tenantId
    });

    try {
      const finalKeyword = keyword || (site.niche && site.niche !== '通用行业' && site.niche !== '通用商业技术'
        ? (site.siteLanguage === 'zh-CN' ? `${site.niche} 核心技术落地与选型指南` : `${site.niche} Architecture Best Practices`)
        : (site.siteLanguage === 'zh-CN' ? 'DeepSeek K8s 部署实践' : 'Kubernetes FinOps Guide 2026'));

      if (hasExistingTopic(tenantData.opportunities || [], site.id, finalKeyword)) {
        throw new ValidationError(`“${finalKeyword}”已在该站点的机会队列或已发布内容中；已阻止重复生产以避免关键词蚕食。`);
      }

      // The automatic system may use a supplied topic without paid keyword data,
      // but it may never manufacture traffic evidence or publish without a
      // customer-approved knowledge source.
      const kbSnippets = this.retrieveKnowledgeSnippets(tenantData, site.id);
      if (!kbSnippets.length) {
        throw new Error('自动发布要求至少一条客户知识库或原创研究资料');
      }

      // Billing is a preflight, not one of the customer-visible SEO stages.
      creditDeductedAmount = await this.deductPipelineCredits(tenantId, site, finalKeyword);

      // Stage 1: SERP Intent & Search Demand Discovery
      const opportunity = await this.discoverSearchDemand(tenantId, site, finalKeyword, traceId);
      stagesCompleted.push('INTENT_DISCOVERY');

      // Stage 2: Enterprise Knowledge RAG Retrieval
      stagesCompleted.push('KNOWLEDGE_RAG_RETRIEVAL');

      // Stage 3: Strategic Brief & Content Architecture
      const brief = await this.synthesizeBrief(tenantId, site.id, opportunity, kbSnippets, traceId);
      stagesCompleted.push('BRIEF_SYNTHESIS');

      // Stage 4: Deep Semantic Article
      const articleResult = await this.aiEngine.generateArticleAndQualityCheck(
        opportunity.targetKeyword, 
        opportunity.language, 
        brief, 
        kbSnippets
      );
      articleResult.qualityGate = applySiteContentQualityGate(
        articleResult.qualityGate,
        articleResult.contentHtml,
        (tenantData.drafts || []).filter((draft) => draft.siteId === site.id && draft.status === 'PUBLISHED')
      );
      stagesCompleted.push('CONTENT_AEO_SYNTHESIS');

      // Stage 5: deterministic quality checks supplement the model report.
      stagesCompleted.push('QUALITY_GATE_EEAT');

      // Stage 6: Semantic Internal Link Weaving
      const internalLinkResult = weaveRelevantInternalLink({
        contentHtml: sanitizeArticleHtml(articleResult.contentHtml),
        articleTitle: articleResult.title,
        targetKeyword: opportunity.targetKeyword,
        siteDomain: site.domain,
        publishedDrafts: (tenantData.drafts || []).filter((draft) => draft.siteId === site.id && draft.status === 'PUBLISHED')
      });
      const finalContentHtml = sanitizeArticleHtml(internalLinkResult.contentHtml);
      stagesCompleted.push('INTERNAL_LINK_WEAVING');

      // Stage 7: determine eligibility and deploy through this site's connector.
      const isAutoEligible = this.checkAutopilotEligibility(site, opportunity, articleResult.qualityGate);
      const deploymentResult = await this.deployToSite(site, articleResult, finalContentHtml, opportunity.category, isAutoEligible);
      stagesCompleted.push('SITE_PUBLICATION');

      // Persist the evidence of stages 1–7 before monitoring begins.
      const draft = await this.persistDraftRecord(
        tenantId,
        site.id,
        opportunity.id,
        articleResult,
        finalContentHtml,
        kbSnippets,
        opportunity.language,
        opportunity.category,
        isAutoEligible,
        deploymentResult.publishedUrl,
        deploymentResult.wpPostId
      );

      // Stage 8: allowed push protocols plus GSC/sitemap monitoring. A
      // submission is never interpreted as a confirmed Google indexation.
      if (isAutoEligible && deploymentResult.publishedUrl) {
        await this.dispatchSearchEnginePush(
          tenantId, 
          site, 
          opportunity, 
          draft, 
          deploymentResult.publishedUrl, 
          traceId
        );
      } else {
        opportunity.status = 'IN_QUALITY_GATE';
        await this.repository.saveOpportunity(tenantId, opportunity);

        eventBus.publish({
          id: `evt-${Date.now()}`,
          type: 'ARTICLE_DRAFT_CREATED',
          tenantId,
          siteId,
          timestamp: new Date().toISOString(),
          payload: draft,
          traceId
        });
      }
      stagesCompleted.push('INDEXING_MONITORING');

      // 10. Audit Logging
      await this.recordAuditLog(tenantId, site, actor, isAutoEligible, articleResult);

      profiler.done(`Pipeline completed in ${stagesCompleted.length} stages`);

      return {
        success: true,
        opportunity,
        draft,
        stagesCompleted,
        executionTimeMs: Date.now() - startTime
      };
    } catch (err: any) {
      profiler.fail(err);

      // Automatic Credit Refund on fatal execution failure
      if (creditDeductedAmount > 0 && typeof this.repository.refundCredits === 'function') {
        try {
          await this.repository.refundCredits(
            tenantId,
            creditDeductedAmount,
            'CRUISE_PIPELINE',
            `全流程发文异常自动补偿退款 (${site.name || site.domain})`,
            { siteId: site.id, error: err?.message || String(err) }
          );
        } catch (refundErr) {
          logger.error('PIPELINE', `Failed to refund credits for tenant ${tenantId}`, refundErr);
        }
      }

      await this.repository.appendAuditLog(tenantId, {
        id: `log-err-${Date.now()}`,
        siteId: site.id,
        timestamp: new Date().toISOString(),
        actor,
        action: 'PIPELINE_ERROR',
        target: site.domain,
        result: 'FAILED',
        details: `执行阶段异常 [${stagesCompleted.slice(-1)[0] || 'INIT'}]: ${err?.message || err}`
      });

      return {
        success: false,
        stagesCompleted,
        executionTimeMs: Date.now() - startTime,
        error: err?.message || String(err)
      };
    }
  }

  private async deductPipelineCredits(tenantId: string, site: WordPressSite, finalKeyword: string): Promise<number> {
    if (typeof (this.repository as any).isActionEnabled === 'function') {
      if (!(this.repository as any).isActionEnabled('CRUISE_PIPELINE')) {
        throw new Error('“一键全流程发文”功能当前已被系统管理员暂停使用。');
      }
    }

    const actionCost = (this.repository as any).getActionCost 
      ? (this.repository as any).getActionCost('CRUISE_PIPELINE', 20) 
      : 20;

    const creditRes = await this.repository.consumeCredits(
      tenantId, 
      actionCost, 
      'CRUISE_PIPELINE', 
      `一键全流程自动发文 (${site.name || site.domain})`, 
      { siteId: site.id, siteName: site.name || site.domain, keyword: finalKeyword }
    );

    if (!creditRes.success) {
      throw new Error(creditRes.message || '积分不足，无法执行发文，请充值 USDT 兑换积分。');
    }

    return actionCost;
  }

  private async discoverSearchDemand(
    tenantId: string, 
    site: WordPressSite, 
    finalKeyword: string, 
    traceId?: string
  ): Promise<Opportunity> {
    const analysis = await this.aiEngine.analyzeSearchDemand(finalKeyword, site.siteLanguage, site.niche);
    
    const opportunity: Opportunity = {
      id: `opp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      siteId: site.id,
      title: analysis.suggestedTitle,
      type: 'NEW_CONTENT',
      language: site.siteLanguage,
      targetKeyword: finalKeyword,
      category: site.whitelistedCategories[0] || '技术干货',
      riskLevel: 'LOW',
      // An LLM may help interpret a topic but cannot measure traffic, ranking,
      // difficulty or conversion potential. Those values remain unavailable
      // until a GSC or SERP provider snapshot is connected.
      estimatedMonthlyVisitsGain: 0,
      demandEvidence: {
        sourceType: 'USER_SEED',
        queryOrTopic: finalKeyword,
        evidenceDescription: `基于用户主题的 AI 意图分析：${analysis.searchIntent}。GSC / DataForSEO 未接入时，不展示搜索量、排名或流量预估。`,
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
      status: 'APPROVED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.repository.saveOpportunity(tenantId, opportunity);

    eventBus.publish({
      id: `evt-${Date.now()}`,
      type: 'OPPORTUNITY_DISCOVERED',
      tenantId,
      siteId: site.id,
      timestamp: new Date().toISOString(),
      payload: opportunity,
      traceId
    });

    return opportunity;
  }

  private retrieveKnowledgeSnippets(tenantData: TenantData, siteId: string): string[] {
    return tenantData.knowledgeSources
      .filter(k => k.siteId === siteId)
      .map(k => `${k.title}: ${k.contentSnippet}`);
  }

  private async synthesizeBrief(
    tenantId: string, 
    siteId: string, 
    opportunity: Opportunity, 
    kbSnippets: string[], 
    traceId?: string
  ) {
    const brief = await this.aiEngine.generateContentBrief(
      opportunity.id, 
      opportunity.targetKeyword, 
      opportunity.language, 
      kbSnippets
    );

    eventBus.publish({
      id: `evt-${Date.now()}`,
      type: 'BRIEF_GENERATED',
      tenantId,
      siteId,
      timestamp: new Date().toISOString(),
      payload: brief,
      traceId
    });

    return brief;
  }

  private checkAutopilotEligibility(site: WordPressSite, _opportunity: Opportunity, qualityGate: QualityGateResult): boolean {
    return (site.autopilotEnabled || site.calibration?.autoPublishUnlocked) && qualityGate.passed;
  }

  private async deployToSite(
    site: WordPressSite,
    articleResult: { title: string; summary: string },
    finalContentHtml: string,
    category: string,
    isAutoEligible: boolean
  ): Promise<{ publishedUrl?: string; wpPostId?: number }> {
    if (!isAutoEligible) {
      return {};
    }

    const seoSlug = generateSeoSlug(articleResult.title);
    const wpRes = await this.wpPublisher.publishPost(site, {
      title: articleResult.title,
      contentHtml: finalContentHtml,
      summary: articleResult.summary,
      slug: seoSlug,
      category,
      status: 'publish'
    });

    if (!wpRes.success || !wpRes.publishedUrl) {
      throw new Error(wpRes.error || `${publishingProviderLabel(site)} 发布未返回有效文章 URL`);
    }

    return {
      publishedUrl: wpRes.publishedUrl,
      wpPostId: wpRes.wpPostId
    };
  }

  private async persistDraftRecord(
    tenantId: string,
    siteId: string,
    opportunityId: string,
    articleResult: { title: string; summary: string; qualityGate: QualityGateResult },
    finalContentHtml: string,
    kbSnippets: string[],
    language: Language | string,
    category: string,
    isAutoEligible: boolean,
    publishedUrl?: string,
    wpPostId?: number
  ): Promise<ArticleDraft> {
    const draft: ArticleDraft = {
      id: `draft-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      opportunityId,
      siteId,
      title: articleResult.title,
      language,
      category,
      summary: articleResult.summary,
      contentHtml: finalContentHtml,
      sourcesUsed: kbSnippets,
      qualityGate: articleResult.qualityGate,
      status: isAutoEligible ? 'PUBLISHED' : 'QUALITY_PASSED',
      publishedUrl,
      publishedAt: isAutoEligible ? new Date().toISOString() : undefined,
      wpPostId,
      createdAt: new Date().toISOString()
    };

    await this.repository.saveDraft(tenantId, draft);
    return draft;
  }

  private async dispatchSearchEnginePush(
    tenantId: string,
    site: WordPressSite,
    opportunity: Opportunity,
    draft: ArticleDraft,
    publishedUrl: string,
    traceId?: string
  ): Promise<void> {
    opportunity.status = 'AUTO_PUBLISHED';
    site.currentWeeklyPublished = (site.currentWeeklyPublished || 0) + 1;
    site.pagesCount = (site.pagesCount || 0) + 1;
    await this.repository.saveSite(tenantId, site);
    await this.repository.saveOpportunity(tenantId, opportunity);

    let anyEnginePushed = false;

    // 1. 百度站长主动推送 (仅中文站点且配置了 Token 时触发)
    if (opportunity.language === 'zh-CN') {
      if (site.baiduToken && site.baiduToken.trim()) {
        const baiduRes = await this.searchEngineSubmitter.pushToBaidu(site.domain, site.baiduToken, [publishedUrl]);
        if (baiduRes.success && !baiduRes.skipped) {
          await this.repository.appendBaiduLog(tenantId, {
            id: `baidu-${Date.now()}`,
            url: publishedUrl,
            submittedAt: new Date().toISOString(),
            type: 'DAILY_API',
            status: 'SUBMITTED',
          remainQuota: baiduRes.remain || 0
          });
          anyEnginePushed = true;
        }
      } else {
        logger.info('PIPELINE', `站点 ${site.domain} 未配置专属百度 Token，已跳过百度推送`);
      }
    }

    // 普通编辑文章不适用 Google Indexing API。第 8 阶段只记录由 canonical URL、
    // 站点地图和 GSC 完成的后续发现/表现监测；不得伪造“已实时收录”。
    if (anyEnginePushed) {
      logger.info('PIPELINE', `站点 ${site.domain} 已完成允许的百度主动推送；Google 仍等待站点地图与 GSC 的自然发现和监测`);
    } else {
      logger.info('PIPELINE', `站点 ${site.domain} 已发布；普通文章等待站点地图与 GSC 的自然发现和后续监测`);
    }

    eventBus.publish({
      id: `evt-${Date.now()}`,
      type: 'ARTICLE_PUBLISHED',
      tenantId,
      siteId: site.id,
      timestamp: new Date().toISOString(),
      payload: draft,
      traceId
    });
  }

  private async recordAuditLog(
    tenantId: string,
    site: WordPressSite,
    actor: 'USER_ADMIN' | 'SYSTEM_AUTOPILOT' | 'POLICY_ENGINE',
    isAutoEligible: boolean,
    articleResult: { title: string; qualityGate: QualityGateResult }
  ): Promise<void> {
    await this.repository.appendAuditLog(tenantId, {
      id: `log-${Date.now()}`,
      siteId: site.id,
      timestamp: new Date().toISOString(),
      actor,
      action: isAutoEligible ? 'AUTO_PUBLISH_ARTICLE' : 'PIPELINE_QUALITY_GATE',
      target: articleResult.title,
      result: articleResult.qualityGate.passed ? 'SUCCESS' : 'WARNING',
      details: isAutoEligible
        ? `自动化全流程完成：已成功发布文章到 https://${site.domain}。普通文章通过 canonical URL、站点地图与 GSC 监测发现状态；不会伪称已被 Google 实时收录。`
        : `自动化内容已生成并通过 E-E-A-T 质检（得分 ${articleResult.qualityGate.overallScore}）。已归入人工复核队列。`
    });
  }

  public async executeBatchPipelines(
    batchOptions: PipelineExecutionOptions[],
    concurrency = 3
  ): Promise<PipelineExecutionResult[]> {
    const results: PipelineExecutionResult[] = [];
    const queue = [...batchOptions];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const res = await this.executePipeline(item);
        results.push(res);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, batchOptions.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
}

export const pipelineOrchestrator = new SEOPipelineOrchestrator();
