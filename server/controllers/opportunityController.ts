import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { Opportunity, ArticleDraft } from "../../src/types/seo";
import { geminiAdapter } from "../infrastructure/ai/geminiAdapter";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { publishingAdapterRouter, publishingProviderLabel } from '../infrastructure/publishing/publishingAdapterRouter';
import { searchEngineAdapter } from "../infrastructure/searchEngine/searchEngineAdapter";
import { serpService } from '../infrastructure/searchEngine/serpService';
import { NotFoundError, ValidationError, ForbiddenError, InsufficientCreditsError, ConflictError } from "../domain/errors";
import { sanitizeArticleHtml } from '../utils/contentSanitizer';
import { applySiteContentQualityGate } from '../application/contentQualityGate';
import { weaveRelevantInternalLink } from '../application/internalLinking';
import { hasExistingTopic } from '../application/opportunitySafety';

export const getSiteOpportunities = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const siteOpps = tenantData.opportunities.filter(o => o.siteId === req.params.id);
  res.json({ opportunities: siteOpps });
};

export const scanOpportunities = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`Site with ID "${req.params.id}" was not found.`);
  }

  const keyword = req.body?.keyword && String(req.body.keyword).trim();
  if (!keyword) throw new ValidationError('请提供需要分析的目标关键词');
  if (!geminiAdapter.isConfigured()) throw new ValidationError('AI 服务尚未配置，无法生成真实的选题与意图分析');
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  if (hasExistingTopic(tenantData.opportunities, site.id, keyword)) {
    throw new ConflictError(`“${keyword}”已在该站点的机会队列或已发布内容中。请改为内容更新任务，避免关键词蚕食与重复扣点。`);
  }
  
  const analysis = await geminiAdapter.analyzeSearchDemand(keyword, site.siteLanguage, site.niche);

  const newOpp: Opportunity = {
    id: `opp-${Date.now()}`,
    siteId: site.id,
    title: analysis.suggestedTitle,
    type: 'NEW_CONTENT',
    language: site.siteLanguage,
    targetKeyword: keyword,
    category: site.whitelistedCategories[0] || '技术干货',
    riskLevel: 'LOW',
    // An LLM can interpret an explicit user seed, but it cannot replace GSC or
    // DataForSEO as evidence of search volume, rank, or projected traffic.
    estimatedMonthlyVisitsGain: 0,
    demandEvidence: {
      sourceType: 'USER_SEED',
      queryOrTopic: keyword,
      evidenceDescription: `基于用户提交关键词的 AI 意图分析：${analysis.searchIntent}。尚未连接 GSC / DataForSEO，因此不展示搜索量、排名或流量预估。`,
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
    status: 'PROPOSED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await fileTenantRepository.saveOpportunity(req.tenantId, newOpp);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: site.id,
    timestamp: new Date().toISOString(),
    actor: 'SYSTEM_AUTOPILOT',
    action: 'SCAN_SEARCH_DEMAND',
    target: keyword,
    result: 'SUCCESS',
    details: `已根据用户种子词生成内容机会: "${newOpp.title}"。GSC / DataForSEO 未连接，搜索指标与优先级评分均未生成。`
  });

  res.json({ opportunity: newOpp });
};

export const generateBrief = async (req: TenantRequest, res: Response) => {
  const opp = fileTenantRepository.getOpportunity(req.tenantId, req.params.oppId);
  if (!opp) {
    throw new NotFoundError(`Opportunity with ID "${req.params.oppId}" was not found.`);
  }

  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const kbSnippets = tenantData.knowledgeSources
    .filter(k => k.siteId === opp.siteId)
    .map(k => `${k.title}: ${k.contentSnippet}`);

  if (!geminiAdapter.isConfigured()) throw new ValidationError('AI 服务尚未配置，无法生成内容大纲');
  if (!kbSnippets.length) {
    throw new ValidationError('知识检索未找到该站点的客户知识库或原创资料，已阻止生成大纲与后续自动发布。');
  }
  const brief = await geminiAdapter.generateContentBrief(opp.id, opp.targetKeyword, opp.language, kbSnippets);

  opp.status = 'APPROVED';
  opp.contentBrief = brief;
  opp.updatedAt = new Date().toISOString();

  await fileTenantRepository.saveOpportunity(req.tenantId, opp);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: opp.siteId,
    timestamp: new Date().toISOString(),
    actor: 'SYSTEM_AUTOPILOT',
    action: 'GENERATE_CONTENT_BRIEF',
    target: opp.targetKeyword,
    result: 'SUCCESS',
    details: `已生成大纲 Content Brief，包含 E-E-A-T 结构及 Schema 规范。`
  });

  res.json({ brief, opportunity: opp });
};

export const generateArticle = async (req: TenantRequest, res: Response) => {
  const opp = fileTenantRepository.getOpportunity(req.tenantId, req.params.oppId);
  if (!opp) {
    throw new NotFoundError(`Opportunity with ID "${req.params.oppId}" was not found.`);
  }

  const site = fileTenantRepository.getSite(req.tenantId, opp.siteId);
  if (!site) {
    throw new NotFoundError(`Site with ID "${opp.siteId}" was not found.`);
  }
  const publishingReadiness = publishingAdapterRouter.readiness(site);
  if (!publishingReadiness.ready) {
    throw new ValidationError(publishingReadiness.reason || `${publishingProviderLabel(site)} 发布连接器不可用；已在生成与扣点前阻止自动发布。`);
  }
  if (!geminiAdapter.isConfigured()) throw new ValidationError('AI 服务尚未配置，无法生成文章');

  const knowledgeSources = fileTenantRepository.getTenantData(req.tenantId).knowledgeSources
    .filter((source) => source.siteId === opp.siteId)
    .map((source) => `${source.title}: ${source.contentSnippet}`);
  if (!knowledgeSources.length) throw new ValidationError('请先为站点添加至少一条客户知识库或原创研究资料，自动发布不能使用虚构来源');

  // 扣除积分 (AI 单独写稿生成根据管理员配置动态扣除，默认 10 积分)
  if (!fileTenantRepository.isActionEnabled('DRAFT_GENERATE')) {
    throw new ForbiddenError('“AI 文章单独生成”功能当前已被系统管理员暂停使用。');
  }

  const draftCost = fileTenantRepository.getActionCost('DRAFT_GENERATE', 10);
  const creditRes = await fileTenantRepository.consumeCredits(
    req.tenantId, 
    draftCost, 
    'DRAFT_GENERATE', 
    `AI 深度文章创作 (${opp.targetKeyword})`,
    { siteId: site.id, siteName: site.name, keyword: opp.targetKeyword }
  );

  if (!creditRes.success) {
    throw new InsufficientCreditsError(creditRes.message || '积分不足，请充值 USDT');
  }

  try {
    const tenantData = fileTenantRepository.getTenantData(req.tenantId);
    const kbSnippets = knowledgeSources;

    // Cruise first persists the retrieved and planned brief. Reuse that exact
    // artifact for writing; a hidden second planning pass would make steps 2–3
    // decorative rather than causally connected to the published page.
    let brief = opp.contentBrief;
    if (!brief || brief.opportunityId !== opp.id || brief.targetKeyword !== opp.targetKeyword) {
      brief = await geminiAdapter.generateContentBrief(opp.id, opp.targetKeyword, opp.language, kbSnippets);
      opp.contentBrief = brief;
      opp.updatedAt = new Date().toISOString();
      await fileTenantRepository.saveOpportunity(req.tenantId, opp);
    }
    const result = await geminiAdapter.generateArticleAndQualityCheck(opp.targetKeyword, opp.language, brief, kbSnippets);
    result.qualityGate = applySiteContentQualityGate(
      result.qualityGate,
      result.contentHtml,
      tenantData.drafts.filter((draft) => draft.siteId === site.id && draft.status === 'PUBLISHED')
    );

    // Weave an internal link only when there is a real, already-published target.
    // The result is returned to the client so the pipeline never claims a link
    // insertion that did not happen.
    let finalContentHtml = sanitizeArticleHtml(result.contentHtml);
    const otherPublished = tenantData.drafts.filter(d => d.siteId === site.id && d.status === 'PUBLISHED' && d.publishedUrl);
    const linkedArticle = weaveRelevantInternalLink({
      contentHtml: finalContentHtml,
      articleTitle: result.title,
      targetKeyword: opp.targetKeyword,
      siteDomain: site.domain,
      publishedDrafts: otherPublished
    });
    finalContentHtml = sanitizeArticleHtml(linkedArticle.contentHtml);
    const internalLinking = linkedArticle.decision;

    const isAutoEligible = result.qualityGate.passed;

    let publishedUrl: string | undefined;
    let wpPostId: number | undefined;
    const indexingResults: Array<{
      provider: 'BAIDU' | 'GOOGLE';
      status: 'SUBMITTED' | 'SKIPPED' | 'FAILED';
      message: string;
    }> = [];

    if (isAutoEligible) {
      const wpRes = await publishingAdapterRouter.forSite(site).publishPost(site, {
        title: result.title,
        contentHtml: finalContentHtml,
        summary: result.summary,
        category: opp.category,
        status: 'publish'
      });
      if (!wpRes.success || !wpRes.publishedUrl) {
        throw new Error(wpRes.error || `${publishingProviderLabel(site)} 自动发布未返回有效文章链接`);
      }
      publishedUrl = wpRes.publishedUrl;
      wpPostId = wpRes.wpPostId;
    }

    const newDraft: ArticleDraft = {
      id: `draft-${Date.now()}`,
      opportunityId: opp.id,
      siteId: opp.siteId,
      title: result.title,
      language: opp.language,
      category: opp.category,
      summary: result.summary,
      contentHtml: finalContentHtml,
      sourcesUsed: kbSnippets,
      qualityGate: result.qualityGate,
      status: isAutoEligible ? 'PUBLISHED' : 'QUALITY_FAILED',
      publishedUrl,
      publishedAt: isAutoEligible ? new Date().toISOString() : undefined,
      wpPostId,
      createdAt: new Date().toISOString()
    };

    if (isAutoEligible && publishedUrl) {
      opp.status = 'AUTO_PUBLISHED';
      site.currentWeeklyPublished = (site.currentWeeklyPublished || 0) + 1;
      site.pagesCount = (site.pagesCount || 0) + 1;
      await fileTenantRepository.saveSite(req.tenantId, site);

      const [baiduRes, googleRes] = await Promise.all([
        opp.language === 'zh-CN'
          ? searchEngineAdapter.pushToBaidu(site.domain, site.baiduToken, [publishedUrl])
          : Promise.resolve(undefined),
        searchEngineAdapter.pushToGoogle(site.domain, site.googleServiceAccountJson, [publishedUrl])
      ]);

      if (baiduRes) {
        indexingResults.push({
          provider: 'BAIDU',
          status: !baiduRes.success ? 'FAILED' : baiduRes.skipped ? 'SKIPPED' : 'SUBMITTED',
          message: baiduRes.message
        });
        if (baiduRes.success && !baiduRes.skipped) {
          await fileTenantRepository.appendBaiduLog(req.tenantId, {
            id: `baidu-${Date.now()}`,
            url: publishedUrl,
            submittedAt: new Date().toISOString(),
            type: 'DAILY_API',
            status: 'SUBMITTED',
            remainQuota: baiduRes.remain || 0
          });
        }
      }

      indexingResults.push({
        provider: 'GOOGLE',
        status: !googleRes.success ? 'FAILED' : googleRes.skipped ? 'SKIPPED' : 'SUBMITTED',
        message: googleRes.message
      });
    } else {
      opp.status = 'REJECTED';
    }

    const indexingStatus = indexingResults.some((result) => result.status === 'FAILED')
      ? 'FAILED'
      : indexingResults.some((result) => result.status === 'SUBMITTED')
        ? 'SUBMITTED'
        : 'SKIPPED';
    const indexingMessages = indexingResults.map((result) => `${result.provider === 'BAIDU' ? '百度' : 'Google'}：${result.message}`);

    opp.updatedAt = new Date().toISOString();
    await fileTenantRepository.saveDraft(req.tenantId, newDraft);
    await fileTenantRepository.saveOpportunity(req.tenantId, opp);

    await fileTenantRepository.appendAuditLog(req.tenantId, {
      id: `log-${Date.now()}`,
      siteId: opp.siteId,
      timestamp: new Date().toISOString(),
      actor: 'SYSTEM_AUTOPILOT',
      action: isAutoEligible ? 'AUTO_PUBLISH_ARTICLE' : 'QUALITY_GATE_BLOCKED',
      target: result.title,
      result: result.qualityGate.passed ? 'SUCCESS' : 'WARNING',
      details: isAutoEligible 
        ? `质量门禁已通过并自动发布至目标站点，文章 URL: ${newDraft.publishedUrl}。${indexingMessages.join('；') || '普通文章将由 canonical URL、站点地图与 GSC 监测自然发现状态。'}`
        : `质量门禁未通过（得分 ${result.qualityGate.overallScore}），已阻止自动发布。`
    });

    res.json({
      draft: newDraft,
      opportunity: opp,
      automation: {
        internalLinking,
        publishing: isAutoEligible && publishedUrl
          ? {
              status: 'PUBLISHED',
              message: `已通过 ${publishingProviderLabel(site)} 自动发布。`,
              publishedUrl
            }
          : {
              status: 'BLOCKED',
              message: `质量门禁未通过（得分 ${result.qualityGate.overallScore}），未调用 ${publishingProviderLabel(site)} 发布。`
            },
        indexing: {
          status: indexingStatus,
          results: indexingResults
        }
      }
    });
  } catch (err: any) {
    // 自动补偿退还积分
    await fileTenantRepository.refundCredits(
      req.tenantId,
      draftCost,
      'DRAFT_GENERATE',
      `文章创作失败自动退款 (${opp.targetKeyword})`,
      { siteId: site.id, error: err?.message }
    );
    throw err;
  }
};

export const scanCompetitorAttack = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`Site with ID "${req.params.id}" was not found.`);
  }

  const competitor = (req.body && req.body.competitor && String(req.body.competitor).trim()) || 'notion.so';

  // 扣除积分 (竞品渗透分析根据管理员配置动态扣除，默认 15 积分)
  if (!fileTenantRepository.isActionEnabled('COMPETITOR_ANALYSIS')) {
    throw new ForbiddenError('“竞品攻击与流量穿透分析”功能当前已被系统管理员暂停使用。');
  }

  const analysisCost = fileTenantRepository.getActionCost('COMPETITOR_ANALYSIS', 15);
  const creditRes = await fileTenantRepository.consumeCredits(
    req.tenantId,
    analysisCost,
    'COMPETITOR_ANALYSIS',
    `竞品攻击与流量穿透分析 (${competitor})`,
    { siteId: site.id, siteName: site.name, keyword: competitor }
  );

  if (!creditRes.success) {
    throw new InsufficientCreditsError(creditRes.message || '积分不足，请充值 USDT');
  }

  try {
    const analysis = await geminiAdapter.analyzeCompetitorGapsAndAttack(competitor, site.siteLanguage, site.niche);

    await fileTenantRepository.appendAuditLog(req.tenantId, {
      id: `log-${Date.now()}`,
      siteId: site.id,
      timestamp: new Date().toISOString(),
      actor: 'USER_ADMIN',
      action: 'COMPETITOR_ATTACK_ANALYSIS',
      target: competitor,
      result: 'SUCCESS',
      details: `针对竞品 "${competitor}" 完成逆向意图挖掘，生成 ${analysis.attackKeywords.length} 个进攻词与盲区诊断。`
    });

    res.json({ analysis });
  } catch (err: any) {
    await fileTenantRepository.refundCredits(
      req.tenantId,
      analysisCost,
      'COMPETITOR_ANALYSIS',
      `竞品分析失败自动退款 (${competitor})`,
      { siteId: site.id, error: err?.message }
    );
    throw err;
  }
};

export const serpScan = async (req: TenantRequest, res: Response) => {
  const { seedKeyword, location } = req.body || {};
  if (!seedKeyword || typeof seedKeyword !== 'string' || !seedKeyword.trim()) {
    throw new ValidationError('seedKeyword is required and cannot be empty');
  }
  const result = await serpService.scanKeywordOpportunities({ seedKeyword: seedKeyword.trim(), location });
  res.json(result);
};
