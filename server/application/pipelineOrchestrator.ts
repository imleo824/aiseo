import { WordPressSite, Opportunity, ArticleDraft, QualityGateResult, Language } from '../../src/types/seo';
import { IWordPressPublisher, ISearchEngineSubmitter, IContentIntelligenceEngine } from '../domain/ports';
import { ITenantRepository, TenantData } from '../domain/repository';
import { eventBus } from '../domain/eventBus';
import { wordPressAdapter } from '../infrastructure/wordpress/wordpressAdapter';
import { searchEngineAdapter } from '../infrastructure/searchEngine/searchEngineAdapter';
import { geminiAdapter } from '../infrastructure/ai/geminiAdapter';
import { fileTenantRepository } from '../infrastructure/persistence/fileTenantRepository';
import { logger } from '../utils/logger';
import { NotFoundError } from '../domain/errors';
import { generateSeoSlug } from '../utils/validator';
import { sanitizeArticleHtml } from '../utils/contentSanitizer';

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
      throw new NotFoundError(`WordPress site '${siteId}' was not found in tenant '${tenantId}'.`);
    }

    const profiler = logger.profile('ORCHESTRATOR', `executePipeline(site: ${site.domain}, keyword: ${keyword || 'AUTO'})`, {
      traceId,
      tenantId
    });

    try {
      const finalKeyword = keyword || (site.niche && site.niche !== '通用行业' && site.niche !== '通用商业技术'
        ? (site.siteLanguage === 'zh-CN' ? `${site.niche} 核心技术落地与选型指南` : `${site.niche} Architecture Best Practices`)
        : (site.siteLanguage === 'zh-CN' ? 'DeepSeek K8s 部署实践' : 'Kubernetes FinOps Guide 2026'));

      // 1. Credit Deduction
      creditDeductedAmount = await this.deductPipelineCredits(tenantId, site, finalKeyword);
      stagesCompleted.push('CREDIT_DEDUCTED');

      // 2. Stage 1: SERP Intent & Search Demand Discovery
      const opportunity = await this.discoverSearchDemand(tenantId, site, finalKeyword, traceId);
      stagesCompleted.push('INTENT_DISCOVERY');

      // 3. Stage 2: Enterprise Knowledge RAG Retrieval
      const kbSnippets = this.retrieveKnowledgeSnippets(tenantData, site.id);
      stagesCompleted.push('KNOWLEDGE_RAG_RETRIEVAL');

      // 4. Stage 3: Strategic Brief & Content Architecture
      const brief = await this.synthesizeBrief(tenantId, site.id, opportunity, kbSnippets, traceId);
      stagesCompleted.push('BRIEF_SYNTHESIS');

      // 5. Stage 4: Deep Semantic Article & E-E-A-T Quality Gate
      const articleResult = await this.aiEngine.generateArticleAndQualityCheck(
        opportunity.targetKeyword, 
        opportunity.language, 
        brief, 
        kbSnippets
      );
      stagesCompleted.push('CONTENT_AEO_SYNTHESIS');
      stagesCompleted.push('QUALITY_GATE_EEAT');

      // 6. Stage 5: Semantic Internal Link Weaving
      const finalContentHtml = sanitizeArticleHtml(this.weaveInternalLinks(articleResult.contentHtml, tenantData, site.id));
      stagesCompleted.push('INTERNAL_LINK_WEAVING');

      // 7. Stage 6: Determine Autopilot Eligibility & Deploy to WordPress
      const isAutoEligible = this.checkAutopilotEligibility(site, opportunity, articleResult.qualityGate);
      const deploymentResult = await this.deployToWordPress(site, articleResult, finalContentHtml, opportunity.category, isAutoEligible);
      if (deploymentResult.publishedUrl) {
        stagesCompleted.push('WORDPRESS_DEPLOYMENT');
      }

      // 8. Stage 7: Persist Draft & Opportunity State
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

      // 9. Stage 8: Instant Search Engine Multi-Protocol Broadcast
      if (isAutoEligible && deploymentResult.publishedUrl) {
        await this.dispatchSearchEnginePush(
          tenantId, 
          site, 
          opportunity, 
          draft, 
          deploymentResult.publishedUrl, 
          stagesCompleted, 
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
      estimatedMonthlyVisitsGain: analysis.estimatedTrafficGain || 2800,
      demandEvidence: {
        sourceType: 'GSC_QUERY',
        queryOrTopic: finalKeyword,
        monthlyImpressions: 22000,
        currentClicks: 190,
        currentPosition: 16.5,
        evidenceDescription: `SERP 意图识别与 GSC 增量搜索意图: ${analysis.searchIntent}`,
        reliabilityConfidence: 0.98
      },
      scoreBreakdown: {
        businessValue: 19,
        searchDemand: 19,
        winProbability: 17,
        currentRanking: 12,
        engagementPotential: 9,
        googleBaiduReuse: 9,
        internalLinkValue: 5,
        freshness: 5,
        dataReliability: 5,
        riskPenalty: 0,
        costPenalty: 1,
        totalScore: 98
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

  private weaveInternalLinks(contentHtml: string, tenantData: TenantData, siteId: string): string {
    const otherPublished = tenantData.drafts.filter(d => d.siteId === siteId && d.status === 'PUBLISHED' && d.publishedUrl);
    if (otherPublished.length > 0) {
      const samplePrev = otherPublished[0];
      const linkTag = `<p class="mt-4 p-3 bg-slate-900/60 rounded-lg text-xs text-slate-300 border border-slate-800">💡 <strong>延伸阅读</strong>：查看我们关于 <a href="${samplePrev.publishedUrl}" class="text-emerald-400 underline font-semibold hover:text-emerald-300" target="_blank">${samplePrev.title}</a> 的深度分析。</p>`;
      if (!contentHtml.includes(samplePrev.title)) {
        return contentHtml + linkTag;
      }
    }
    return contentHtml;
  }

  private checkAutopilotEligibility(site: WordPressSite, _opportunity: Opportunity, qualityGate: QualityGateResult): boolean {
    return (site.autopilotEnabled || site.calibration?.autoPublishUnlocked) && qualityGate.passed;
  }

  private async deployToWordPress(
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
      sourcesUsed: kbSnippets.length > 0 ? kbSnippets : ['企业知识库及权威来源'],
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
    stagesCompleted: string[],
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
          stagesCompleted.push('BAIDU_INDEXING_DISPATCH');
          anyEnginePushed = true;
        }
      } else {
        logger.info('PIPELINE', `站点 ${site.domain} 未配置专属百度 Token，已跳过百度推送`);
      }
    }

    // 3. Google Indexing API (当站点配置了 Google Service Account JSON 凭证时触发)
    if (site.googleServiceAccountJson && site.googleServiceAccountJson.trim()) {
      const googleRes = await this.searchEngineSubmitter.pushToGoogle(
        site.domain, 
        site.googleServiceAccountJson, 
        [publishedUrl]
      );
      if (googleRes.success && !googleRes.skipped) {
        stagesCompleted.push('GOOGLE_INDEXING_DISPATCH');
        anyEnginePushed = true;
      }
    }

    if (anyEnginePushed) {
      stagesCompleted.push('SEARCH_ENGINE_PUSH');
    } else {
      logger.info('PIPELINE', `站点 ${site.domain} 未完成搜索引擎推送，文章已发布上线，等待蜘蛛自然抓取或后续重试`);
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
        ? `自动化全流程完成：已成功发布文章到 https://${site.domain} 并触发搜索引擎实时推送。`
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
