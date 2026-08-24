import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { WordPressSite } from "../../src/types/seo";
import { validateSiteInput, validateDomain } from "../utils/validator";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { wordPressAdapter } from "../infrastructure/wordpress/wordpressAdapter";
import { NotFoundError, ValidationError, ConflictError } from "../domain/errors";

export const getSites = async (req: TenantRequest, res: Response) => {
  const data = fileTenantRepository.getTenantData(req.tenantId);
  res.json({ sites: data.sites || [] });
};

export const getSiteById = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`WordPress Site with ID "${req.params.id}" was not found.`);
  }
  res.json({ site });
};

export const testSiteConnection = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`WordPress Site with ID "${req.params.id}" was not found.`);
  }

  const result = await wordPressAdapter.testConnection(site);
  site.connectorStatus = result.connected ? 'CONNECTED' : 'ERROR';
  await fileTenantRepository.saveSite(req.tenantId, site);

  res.json({ result, site });
};

export const createSite = async (req: TenantRequest, res: Response) => {
  const validation = validateSiteInput(req.body);
  if (!validation.isValid) {
    throw new ValidationError(validation.errors.join(", "), { details: validation.errors });
  }

  const { 
    name, 
    domain, 
    niche, 
    siteType,
    siteLanguage, 
    monthlyBudgetLimit, 
    weeklyPublishCap,
    wpUsername,
    wpAppPassword,
    wpRestEndpoint,
    baiduToken,
    indexNowKey
  } = req.body;
  const { sanitized: cleanDomain } = validateDomain(domain);

  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const existing = tenantData.sites.find(s => s.domain.toLowerCase() === cleanDomain.toLowerCase());
  if (existing) {
    throw new ConflictError(`站点域名 ${cleanDomain} 已经在当前租户中绑定，请勿重复添加。`);
  }

  // 扣除积分 (新增站点诊断与初始化接入根据管理员配置动态扣除，默认 5 积分)
  if (!fileTenantRepository.isActionEnabled('SITE_AUDIT')) {
    res.status(403).json({ success: false, message: '“站点添加与深度连接体检”功能当前已被系统管理员暂停使用。' });
    return;
  }

  const auditCost = fileTenantRepository.getActionCost('SITE_AUDIT', 5);
  const creditRes = await fileTenantRepository.consumeCredits(
    req.tenantId,
    auditCost,
    'SITE_AUDIT',
    `绑定新站点并深度体检 (${cleanDomain})`,
    { domain: cleanDomain }
  );

  if (!creditRes.success) {
    res.status(402).json({ success: false, message: creditRes.message || '积分不足，请充值 USDT' });
    return;
  }

  try {
    const newSite: WordPressSite = {
      id: `site-${Date.now()}`,
      name: (name && String(name).trim()) || cleanDomain,
      domain: cleanDomain,
      niche: (niche && String(niche).trim()) || '通用行业',
      siteType: siteType || 'WORDPRESS',
      siteLanguage: siteLanguage || 'zh-CN',
      pagesCount: 120,
      connectorStatus: 'CONNECTED',
      wpVersion: '6.7.1',
      wpUsername: wpUsername ? String(wpUsername).trim() : undefined,
      wpAppPassword: wpAppPassword ? String(wpAppPassword).trim() : undefined,
      wpRestEndpoint: wpRestEndpoint ? String(wpRestEndpoint).trim() : undefined,
      baiduToken: baiduToken ? String(baiduToken).trim() : undefined,
      indexNowKey: indexNowKey ? String(indexNowKey).trim() : undefined,
      pluginInstalled: true,
      whitelistedCategories: ['技术干货', '行业新闻'],
      gscConnected: true,
      ga4Connected: true,
      baiduConnected: Boolean(baiduToken) || siteLanguage === 'zh-CN',
      autopilotEnabled: false,
      weeklyPublishCap: Number(weeklyPublishCap) || 2,
      currentWeeklyPublished: 0,
      calibration: {
        isCalibrating: true,
        daysRemaining: 14,
        totalApprovedRequired: 10,
        approvedCount: 0,
        rejectedCount: 0,
        zeroFactErrorStreak: 0,
        autoPublishUnlocked: false
      },
      monthlyBudgetLimit: Number(monthlyBudgetLimit) || 100,
      monthlyBudgetUsed: 0,
      createdAt: new Date().toISOString()
    };

    await fileTenantRepository.saveSite(req.tenantId, newSite);
    await fileTenantRepository.appendAuditLog(req.tenantId, {
      id: `log-${Date.now()}`,
      siteId: newSite.id,
      timestamp: new Date().toISOString(),
      actor: 'USER_ADMIN',
      action: 'CONNECT_WORDPRESS_SITE',
      target: newSite.name,
      result: 'SUCCESS',
      details: `已接入 WordPress 独立站: ${newSite.domain}，初始化 14 天校准期模式。`
    });

    res.status(201).json({ site: newSite });
  } catch (err: any) {
    await fileTenantRepository.refundCredits(
      req.tenantId,
      auditCost,
      'SITE_AUDIT',
      `站点接入失败自动退款 (${cleanDomain})`,
      { domain: cleanDomain, error: err?.message }
    );
    throw err;
  }
};

export const updateSite = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`Site with ID "${req.params.id}" was not found.`);
  }

  const { 
    name, 
    domain,
    niche, 
    siteType,
    siteLanguage, 
    weeklyPublishCap, 
    monthlyBudgetLimit, 
    whitelistedCategories,
    wpUsername,
    wpAppPassword,
    wpRestEndpoint,
    baiduToken,
    indexNowKey,
    leadCaptureCta,
    autopilotEnabled
  } = req.body;

  if (name !== undefined) site.name = String(name).trim();
  if (domain !== undefined && String(domain).trim()) {
    site.domain = String(domain).trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  if (niche !== undefined) site.niche = String(niche).trim();
  if (siteType !== undefined) site.siteType = siteType;
  if (siteLanguage !== undefined) site.siteLanguage = siteLanguage;
  if (weeklyPublishCap !== undefined) site.weeklyPublishCap = Math.max(1, Math.min(50, Number(weeklyPublishCap) || 1));
  if (monthlyBudgetLimit !== undefined) site.monthlyBudgetLimit = Math.max(10, Number(monthlyBudgetLimit) || 100);
  if (autopilotEnabled !== undefined) site.autopilotEnabled = Boolean(autopilotEnabled);
  if (whitelistedCategories !== undefined && Array.isArray(whitelistedCategories)) {
    site.whitelistedCategories = whitelistedCategories.filter(c => typeof c === 'string' && c.trim().length > 0);
  }
  if (wpUsername !== undefined) site.wpUsername = wpUsername ? String(wpUsername).trim() : undefined;
  if (wpAppPassword !== undefined) site.wpAppPassword = wpAppPassword ? String(wpAppPassword).trim() : undefined;
  if (wpRestEndpoint !== undefined) site.wpRestEndpoint = wpRestEndpoint ? String(wpRestEndpoint).trim() : undefined;
  if (baiduToken !== undefined) {
    site.baiduToken = baiduToken ? String(baiduToken).trim() : undefined;
    site.baiduConnected = Boolean(site.baiduToken);
  }
  if (indexNowKey !== undefined) site.indexNowKey = indexNowKey ? String(indexNowKey).trim() : undefined;
  if (leadCaptureCta !== undefined && typeof leadCaptureCta === 'object') {
    site.leadCaptureCta = {
      enabled: Boolean(leadCaptureCta.enabled),
      title: String(leadCaptureCta.title || ''),
      buttonText: String(leadCaptureCta.buttonText || ''),
      targetUrl: String(leadCaptureCta.targetUrl || ''),
      calloutNote: leadCaptureCta.calloutNote ? String(leadCaptureCta.calloutNote) : undefined
    };
  }

  await fileTenantRepository.saveSite(req.tenantId, site);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: site.id,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'UPDATE_SITE_CONFIG',
    target: site.name,
    result: 'SUCCESS',
    details: '已更新站点配置与凭证参数。'
  });

  res.json({ site });
};

export const deleteSite = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`Site with ID "${req.params.id}" was not found.`);
  }

  await fileTenantRepository.removeSite(req.tenantId, req.params.id);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: site.id,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'DELETE_SITE',
    target: site.name,
    result: 'SUCCESS',
    details: `已解绑 WordPress 站点: ${site.domain}`
  });

  res.json({ success: true, message: `站点 ${site.name} 已成功移除。` });
};

export const toggleAutopilot = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`Site with ID "${req.params.id}" was not found.`);
  }

  const newState = req.body.enabled !== undefined ? Boolean(req.body.enabled) : !site.autopilotEnabled;

  if (newState && site.calibration.isCalibrating && !site.calibration.autoPublishUnlocked) {
    throw new ValidationError("站点处于 14 天专家校准期，需完成 10 篇人工审核且 0 事实错误后方可解锁全自动巡航。");
  }

  site.autopilotEnabled = newState;
  await fileTenantRepository.saveSite(req.tenantId, site);
  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: site.id,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: newState ? 'ENABLE_AUTOPILOT' : 'DISABLE_AUTOPILOT',
    target: site.name,
    result: 'SUCCESS',
    details: newState ? '已启用 SEO 全自动巡航发布。' : '已暂停全自动巡航，转为人工审核模式。'
  });

  res.json({ site });
};
