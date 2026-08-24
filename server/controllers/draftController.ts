import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { wordPressAdapter } from "../infrastructure/wordpress/wordpressAdapter";
import { searchEngineAdapter } from "../infrastructure/searchEngine/searchEngineAdapter";
import { NotFoundError } from "../domain/errors";

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

  // 1. WordPress REST Publishing
  const wpRes = await wordPressAdapter.publishPost(site, {
    title: draft.title,
    contentHtml: draft.contentHtml,
    summary: draft.summary,
    category: draft.category,
    status: 'publish'
  });

  if (!wpRes.success || !wpRes.publishedUrl) {
    return res.status(500).json({ 
      error: { code: 'WP_PUBLISH_FAILED', message: wpRes.error || '发布到 WordPress 失败' } 
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
  let pushDetail = '搜索引擎推送已分发';
  if (site && draft.publishedUrl) {
    if (draft.language === 'zh-CN' && site.baiduToken) {
      const baiduRes = await searchEngineAdapter.pushToBaidu(site.domain, site.baiduToken, [draft.publishedUrl]);
      await fileTenantRepository.appendBaiduLog(req.tenantId, {
        id: `baidu-${Date.now()}`,
        url: draft.publishedUrl,
        submittedAt: new Date().toISOString(),
        type: 'DAILY_API',
        status: 'SUBMITTED',
        remainQuota: baiduRes.remain || 90
      });
      pushDetail = baiduRes.message;
    }

    if (site.googleServiceAccountJson) {
      await searchEngineAdapter.pushToGoogle(site.domain, site.googleServiceAccountJson, [draft.publishedUrl]);
    }
  }

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
    details: `用户人工审核通过并推送至目标站点！URL: ${draft.publishedUrl} · ${pushDetail} (REST API 实时写入)`
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
    const delRes = await wordPressAdapter.deletePost(site, draft.wpPostId);
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
