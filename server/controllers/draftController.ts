import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { publishingAdapterRouter, publishingProviderLabel } from '../infrastructure/publishing/publishingAdapterRouter';
import { searchEngineAdapter } from "../infrastructure/searchEngine/searchEngineAdapter";
import { NotFoundError } from "../domain/errors";
import { ValidationError } from '../domain/errors';

export const getDrafts = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  res.json({ drafts: tenantData.drafts || [] });
};

export const approveAndPublishDraft = async (req: TenantRequest, res: Response) => {
  const draft = fileTenantRepository.getDraft(req.tenantId, req.params.id);
  if (!draft) {
    throw new NotFoundError(`Draft with ID "${req.params.id}" was not found.`);
  }

  const site = fileTenantRepository.getSite(req.tenantId, draft.siteId);
  const opp = fileTenantRepository.getOpportunity(req.tenantId, draft.opportunityId);

  if (!site) {
    throw new NotFoundError(`Site with ID "${draft.siteId}" was not found.`);
  }
  if (!draft.qualityGate?.passed || draft.status === 'QUALITY_FAILED') {
    throw new ValidationError('质量门禁未通过，已阻止发布。请修订草稿后重新生成。');
  }
  const publishingReadiness = publishingAdapterRouter.readiness(site);
  if (!publishingReadiness.ready) {
    throw new ValidationError(publishingReadiness.reason || `${publishingProviderLabel(site)} 发布连接器不可用；未调用 WordPress 或其他发布 API。`);
  }

  // 1. Publish through the connector declared by this exact site type.
  const wpRes = await publishingAdapterRouter.forSite(site).publishPost(site, {
    title: draft.title,
    contentHtml: draft.contentHtml,
    summary: draft.summary,
    category: draft.category,
    status: 'publish'
  });

  if (!wpRes.success || !wpRes.publishedUrl) {
    return res.status(500).json({ 
      error: { code: 'SITE_PUBLISH_FAILED', message: wpRes.error || `发布到 ${publishingProviderLabel(site)} 失败` }
    });
  }

  draft.status = 'PUBLISHED';
  draft.publishedUrl = wpRes.publishedUrl;
  draft.publishedAt = new Date().toISOString();
  draft.wpPostId = wpRes.wpPostId;

  if (opp) {
    opp.status = 'PUBLISHED';
    opp.updatedAt = new Date().toISOString();
    await fileTenantRepository.saveOpportunity(req.tenantId, opp);
  }

  // 2. Search Engine Submissions (Multi-Protocol)
  const pushResults: string[] = [];
  if (site && draft.publishedUrl) {
    if (draft.language === 'zh-CN' && site.baiduToken) {
      const baiduRes = await searchEngineAdapter.pushToBaidu(site.domain, site.baiduToken, [draft.publishedUrl]);
      if (baiduRes.success && !baiduRes.skipped) {
        await fileTenantRepository.appendBaiduLog(req.tenantId, {
          id: `baidu-${Date.now()}`,
          url: draft.publishedUrl,
          submittedAt: new Date().toISOString(),
          type: 'DAILY_API',
          status: 'SUBMITTED',
          remainQuota: baiduRes.remain || 0
        });
      }
      pushResults.push(`百度：${baiduRes.message}`);
    }

    // 普通编辑文章不适用 Google Indexing API；以 canonical URL、站点地图和
    // Search Console 数据观察发现与收录，不能把服务账号配置误报为实时收录。
    pushResults.push('Google：普通文章通过站点地图与 GSC 监测发现状态，不调用受限的 Indexing API');
  }
  const pushDetail = pushResults.length ? pushResults.join('；') : '未配置百度推送；普通文章将由站点地图与 GSC 监测自然发现状态';

  if (site) {
    site.pagesCount = (site.pagesCount || 0) + 1;
    site.currentWeeklyPublished = (site.currentWeeklyPublished || 0) + 1;
    if (site.calibration.isCalibrating) {
      site.calibration.approvedCount += 1;
      site.calibration.zeroFactErrorStreak += 1;
      if (site.calibration.approvedCount >= site.calibration.totalApprovedRequired) {
        site.calibration.isCalibrating = false;
        site.calibration.autoPublishUnlocked = true;
        site.calibration.daysRemaining = 0;
      }
    }
    await fileTenantRepository.saveSite(req.tenantId, site);
  }

  await fileTenantRepository.saveDraft(req.tenantId, draft);

  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: draft.siteId,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'MANUAL_APPROVE_PUBLISH',
    target: draft.title,
    result: 'SUCCESS',
    details: `已发布至目标站点。URL: ${draft.publishedUrl}；${pushDetail}`
  });

  res.json({ draft, site, publishedUrl: draft.publishedUrl, wpPostId: draft.wpPostId, isFallback: false });
};

export const rollbackDraft = async (req: TenantRequest, res: Response) => {
  const draft = fileTenantRepository.getDraft(req.tenantId, req.params.id);
  if (!draft) {
    throw new NotFoundError(`Draft with ID "${req.params.id}" was not found.`);
  }

  const site = fileTenantRepository.getSite(req.tenantId, draft.siteId);
  draft.status = 'ROLLED_BACK';

  let deleteMsg = '文章已注销';
  if (site && draft.wpPostId) {
    const delRes = await publishingAdapterRouter.forSite(site).deletePost(site, draft.wpPostId);
    deleteMsg = delRes.message;
  }

  await fileTenantRepository.saveDraft(req.tenantId, draft);

  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: draft.siteId,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'ROLLBACK_ARTICLE',
    target: draft.title,
    result: 'SUCCESS',
    details: `紧急撤回操作：${deleteMsg}，并触发搜索引擎 404/410 清除信号。`
  });

  res.json({ draft });
};
