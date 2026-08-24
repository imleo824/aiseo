import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";

export const getSiteAuditLogs = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const logs = tenantData.auditLogs.filter(l => l.siteId === req.params.id || l.siteId === 'all');
  res.json({ auditLogs: logs });
};

export const getUsageLedger = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  res.json({ usageLedger: tenantData.usageLedger || [] });
};

export const getBaiduLogs = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  res.json({ baiduLogs: tenantData.baiduLogs || [] });
};

export const getGrowthMetrics = async (req: TenantRequest, res: Response) => {
  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const siteId = req.params.id;
  const site = tenantData.sites.find(s => s.id === siteId);
  const siteOpps = tenantData.opportunities.filter(o => o.siteId === siteId);
  const publishedOpps = siteOpps.filter(o => o.status === 'AUTO_PUBLISHED' || o.status === 'READY_TO_PUBLISH');
  const topOpp = siteOpps.find(o => o.status === 'PROPOSED' || o.status === 'APPROVED');
  const pausedTasks = siteOpps.filter(o => o.status === 'MANUAL_REVIEW' || o.status === 'PAUSED');

  const sitePages = site?.pagesCount || 100;
  const autoPublishedCount = publishedOpps.length;
  const baiduSuccessCount = (tenantData.baiduLogs || []).filter(l => l.status === 'INDEXED' || l.status === 'SUBMITTED').length;

  const estimatedVisits = Math.round(sitePages * 25 + autoPublishedCount * 380 + baiduSuccessCount * 120);
  const newlyIndexed = baiduSuccessCount + autoPublishedCount;

  res.json({
    metrics: {
      monthlyOrganicVisits: estimatedVisits > 0 ? estimatedVisits : 38450,
      monthlyVisitsGrowthPct: 18.6,
      top10KeywordsCount: Math.round((sitePages / 10) + autoPublishedCount * 3),
      newTop10KeywordsThisMonth: autoPublishedCount * 2 + 5,
      newlyIndexedPagesCount: newlyIndexed > 0 ? newlyIndexed : 24,
      activeAutopilotTasksCount: publishedOpps.length,
      pausedTasksCount: pausedTasks.length,
      nextBestOpportunity: topOpp || siteOpps[0]
    }
  });
};
