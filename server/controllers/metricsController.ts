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
  const siteOpps = tenantData.opportunities.filter(o => o.siteId === req.params.id);
  const topOpp = siteOpps.find(o => o.status === 'PROPOSED' || o.status === 'APPROVED');
  const pausedTasks = siteOpps.filter(o => o.status === 'MANUAL_REVIEW' || o.status === 'PAUSED');

  res.json({
    metrics: {
      monthlyOrganicVisits: 38450,
      monthlyVisitsGrowthPct: 18.6,
      top10KeywordsCount: 142,
      newTop10KeywordsThisMonth: 18,
      newlyIndexedPagesCount: 24,
      activeAutopilotTasksCount: siteOpps.filter(o => o.status === 'AUTO_PUBLISHED' || o.status === 'READY_TO_PUBLISH').length,
      pausedTasksCount: pausedTasks.length,
      nextBestOpportunity: topOpp || siteOpps[0]
    }
  });
};
