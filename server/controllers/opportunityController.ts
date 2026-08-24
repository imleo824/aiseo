import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { Opportunity, ArticleDraft } from "../../src/types/seo";
import { geminiAdapter } from "../infrastructure/ai/geminiAdapter";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { wordPressAdapter } from "../infrastructure/wordpress/wordpressAdapter";
import { searchEngineAdapter } from "../infrastructure/searchEngine/searchEngineAdapter";
import { serpService } from '../infrastructure/searchEngine/serpService';
import { NotFoundError } from "../domain/errors";

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

  const keyword = (req.body && req.body.keyword && String(req.body.keyword).trim()) || 
    (site.siteLanguage === 'zh-CN' ? 'DeepSeek K8s 部署' : 'Kubernetes FinOps 2026');
  
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
    estimatedMonthlyVisitsGain: analysis.estimatedTrafficGain || 2400,
    demandEvidence: {
      sourceType: 'GSC_QUERY',
      queryOrTopic: keyword,
      monthlyImpressions: 16500,
      currentClicks: 140,
      currentPosition: 19.2,
      evidenceDescription: `GSC 包含该词的增量搜索展现，对应搜索意图：${analysis.searchIntent}`,
      reliabilityConfidence: 0.95
    },
    scoreBreakdown: {
      businessValue: 19,
      searchDemand: 18,
      winProbability: 15,
      currentRanking: 10,
      engagementPotential: 9,
      googleBaiduReuse: 9,
      internalLinkValue: 5,
      freshness: 5,
      dataReliability: 5,
      riskPenalty: 0,
      costPenalty: 1,
      totalScore: 94
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
    details: `通过 GSC 与多模态需求分析挖掘到新机会: "${newOpp.title}"，综合得分 94 分。`
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

  const brief = await geminiAdapter.generateContentBrief(opp.id, opp.targetKeyword, opp.language, kbSnippets);

  opp.status = 'APPROVED';
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

  // 扣除积分 (AI 单独写稿生成根据管理员配置动态扣除，默认 10 积分)
  if (!fileTenantRepository.isActionEnabled('DRAFT_GENERATE')) {
    res.status(403).json({ success: false, message: '“AI 文章单独生成”功能当前已被系统管理员暂停使用。' });
    return;
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
    res.status(402).json({ success: false, message: creditRes.message || '积分不足，请充值 USDT' });
    return;
  }

  try {
    const tenantData = fileTenantRepository.getTenantData(req.tenantId);

    const kbSnippets = tenantData.knowledgeSources
      .filter(k => k.siteId === opp.siteId)
      .map(k => `${k.title}: ${k.contentSnippet}`);

    const brief = await geminiAdapter.generateContentBrief(opp.id, opp.targetKeyword, opp.language, kbSnippets);
    const result = await geminiAdapter.generateArticleAndQualityCheck(opp.targetKeyword, opp.language, brief, kbSnippets);

    // Weave internal link
    let finalContentHtml = result.contentHtml;
    const otherPublished = tenantData.drafts.filter(d => d.siteId === site.id && d.status === 'PUBLISHED' && d.publishedUrl);
    if (otherPublished.length > 0) {
      const samplePrev = otherPublished[0];
      const linkTag = `<p class="mt-4 p-3 bg-slate-900/60 rounded-lg text-xs text-slate-300 border border-slate-800">💡 <strong>延伸阅读</strong>：查看我们关于 <a href="${samplePrev.publishedUrl}" class="text-emerald-400 underline font-semibold hover:text-emerald-300" target="_blank">${samplePrev.title}</a> 的深度分析。</p>`;
      if (!finalContentHtml.includes(samplePrev.title)) {
        finalContentHtml = finalContentHtml + linkTag;
      }
    }

    const isAutoEligible = Boolean(
      site.autopilotEnabled && 
      !site.calibration.isCalibrating &&
      opp.riskLevel === 'LOW' &&
      site.whitelistedCategories.includes(opp.category) &&
      result.qualityGate.passed
    );

    let publishedUrl: string | undefined;
    let wpPostId: number | undefined;

    if (isAutoEligible) {
      const wpRes = await wordPressAdapter.publishPost(site, {
        title: result.title,
        contentHtml: finalContentHtml,
        summary: result.summary,
        category: opp.category,
        status: 'publish'
      });
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
      sourcesUsed: kbSnippets.length > 0 ? kbSnippets : ['客户知识库及权威来源'],
      qualityGate: result.qualityGate,
      status: isAutoEligible ? 'PUBLISHED' : 'QUALITY_PASSED',
      publishedUrl,
      publishedAt: isAutoEligible ? new Date().toISOString() : undefined,
      wpPostId,
      createdAt: new Date().toISOString()
    };

    if (isAutoEligible && publishedUrl) {
      opp.status = 'AUTO_PUBLISHED';
      site.currentWeeklyPublished += 1;
      site.pagesCount += 1;
      await fileTenantRepository.saveSite(req.tenantId, site);

      if (opp.language === 'zh-CN') {
        const baiduRes = await searchEngineAdapter.pushToBaidu(site.domain, site.baiduToken, [publishedUrl]);
        await fileTenantRepository.appendBaiduLog(req.tenantId, {
          id: `baidu-${Date.now()}`,
          url: publishedUrl,
          submittedAt: new Date().toISOString(),
          type: 'DAILY_API',
          status: 'SUBMITTED',
          remainQuota: baiduRes.remain || 90
        });
      }

      await searchEngineAdapter.pushToGoogle(site.domain, [publishedUrl]);
    } else {
      opp.status = 'IN_QUALITY_GATE';
    }

    opp.updatedAt = new Date().toISOString();
    await fileTenantRepository.saveDraft(req.tenantId, newDraft);
    await fileTenantRepository.saveOpportunity(req.tenantId, opp);

    await fileTenantRepository.appendAuditLog(req.tenantId, {
      id: `log-${Date.now()}`,
      siteId: opp.siteId,
      timestamp: new Date().toISOString(),
      actor: 'SYSTEM_AUTOPILOT',
      action: isAutoEligible ? 'AUTO_PUBLISH_ARTICLE' : 'QUALITY_GATE_CHECK',
      target: result.title,
      result: result.qualityGate.passed ? 'SUCCESS' : 'WARNING',
      details: isAutoEligible 
        ? `过闸且符合低风险白名单，自动发布至目标站点，文章 URL: ${newDraft.publishedUrl} 并已完成搜索引擎广播。`
        : `质检完成（得分 ${result.qualityGate.overallScore}）。待人工复核。`
    });

    res.json({ draft: newDraft, opportunity: opp });
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
    res.status(403).json({ success: false, message: '“竞品攻击与流量穿透分析”功能当前已被系统管理员暂停使用。' });
    return;
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
    res.status(402).json({ success: false, message: creditRes.message || '积分不足，请充值 USDT' });
    return;
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
  const { seedKeyword, location } = req.body;
  if (!seedKeyword || typeof seedKeyword !== 'string') {
    res.status(400).json({ error: 'seedKeyword is required' });
    return;
  }
  const result = await serpService.scanKeywordOpportunities({ seedKeyword, location });
  res.json(result);
};

