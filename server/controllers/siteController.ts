import { Response } from "express";
import { TenantRequest } from "../middleware/tenant";
import { WordPressSite } from "../../src/types/seo";
import { validateSiteInput, validateDomain } from "../utils/validator";
import { fileTenantRepository } from "../infrastructure/persistence/fileTenantRepository";
import { wordPressAdapter } from "../infrastructure/wordpress/wordpressAdapter";
import { searchEngineAdapter } from "../infrastructure/searchEngine/searchEngineAdapter";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError, InsufficientCreditsError } from "../domain/errors";

type PublicWordPressSite = Omit<WordPressSite, 'wpAppPassword' | 'baiduToken' | 'googleServiceAccountJson'> & {
  credentialStatus: {
    wordpressConfigured: boolean;
    baiduConfigured: boolean;
    googleConfigured: boolean;
  };
};

const toPublicSite = (site: WordPressSite): PublicWordPressSite => {
  const { wpAppPassword, baiduToken, googleServiceAccountJson, ...publicSite } = site;
  return {
    ...publicSite,
    credentialStatus: {
      wordpressConfigured: Boolean(wpAppPassword),
      baiduConfigured: Boolean(baiduToken),
      googleConfigured: Boolean(googleServiceAccountJson)
    }
  };
};

export const getSites = async (req: TenantRequest, res: Response) => {
  const data = fileTenantRepository.getTenantData(req.tenantId);
  res.json({ sites: (data.sites || []).map(toPublicSite) });
};

export const getSiteById = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`WordPress Site with ID "${req.params.id}" was not found.`);
  }
  res.json({ site: toPublicSite(site) });
};

export const testSiteConnection = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`WordPress Site with ID "${req.params.id}" was not found.`);
  }

  const result = await wordPressAdapter.testConnection(site);
  site.connectorStatus = result.connected ? 'CONNECTED' : 'ERROR';
  await fileTenantRepository.saveSite(req.tenantId, site);

  res.json({ result, site: toPublicSite(site) });
};

export const testSiteSearchEngine = async (req: TenantRequest, res: Response) => {
  const site = fileTenantRepository.getSite(req.tenantId, req.params.id);
  if (!site) {
    throw new NotFoundError(`WordPress Site with ID "${req.params.id}" was not found.`);
  }

  const { engineType, customParams } = req.body;
  const start = Date.now();

  switch (engineType) {
    case 'BAIDU': {
      const token = customParams?.baiduToken !== undefined ? customParams.baiduToken : site.baiduToken;
      if (!token || !token.trim()) {
        res.json({
          engine: 'BAIDU',
          success: false,
          message: '未配置百度推送 Token，无法执行连通性测试',
          testedAt: new Date().toISOString()
        });
        return;
      }
      const testUrl = `https://${site.domain}/seo-probe-${Date.now()}.html`;
      const pushRes = await searchEngineAdapter.pushToBaidu(site.domain, token, [testUrl]);
      res.json({
        engine: 'BAIDU',
        success: pushRes.success && !pushRes.skipped,
        latencyMs: Date.now() - start,
        message: pushRes.message,
        details: pushRes,
        testedAt: new Date().toISOString()
      });
      return;
    }

    case 'GOOGLE': {
      const serviceAccountJson = customParams?.googleServiceAccountJson !== undefined 
        ? customParams.googleServiceAccountJson 
        : site.googleServiceAccountJson;
      if (!serviceAccountJson || !serviceAccountJson.trim()) {
        res.json({
          engine: 'GOOGLE',
          success: false,
          message: '未配置 Google Service Account 凭证，无法执行连通性测试',
          testedAt: new Date().toISOString()
        });
        return;
      }
      const testUrl = `https://${site.domain}/google-probe-${Date.now()}.html`;
      const pushRes = await searchEngineAdapter.pushToGoogle(site.domain, serviceAccountJson, [testUrl]);
      res.json({
        engine: 'GOOGLE',
        success: pushRes.success && !pushRes.skipped,
        latencyMs: Date.now() - start,
        message: pushRes.message,
        details: pushRes,
        testedAt: new Date().toISOString()
      });
      return;
    }

    default:
      res.status(400).json({
        success: false,
        message: `未知的搜索引擎类型: ${engineType}，支持 BAIDU, GOOGLE`
      });
  }
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
    wpUsername,
    wpAppPassword,
    baiduToken,
    googleServiceAccountJson
  } = req.body;
  const { sanitized: cleanDomain } = validateDomain(domain);

  const tenantData = fileTenantRepository.getTenantData(req.tenantId);
  const existing = tenantData.sites.find(s => s.domain.toLowerCase() === cleanDomain.toLowerCase());
  if (existing) {
    throw new ConflictError(`站点域名 ${cleanDomain} 已经在当前租户中绑定，请勿重复添加。`);
  }

  // 扣除积分 (新增站点诊断与初始化接入根据管理员配置动态扣除，默认 5 积分)
  if (!fileTenantRepository.isActionEnabled('SITE_AUDIT')) {
    throw new ForbiddenError('“站点添加与深度连接体检”功能当前已被系统管理员暂停使用。');
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
    throw new InsufficientCreditsError(creditRes.message || '积分不足，请充值 USDT');
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
      baiduToken: baiduToken ? String(baiduToken).trim() : undefined,
      googleServiceAccountJson: googleServiceAccountJson ? String(googleServiceAccountJson).trim() : undefined,
      pluginInstalled: true,
      whitelistedCategories: ['技术干货', '行业新闻'],
      gscConnected: Boolean(googleServiceAccountJson),
      ga4Connected: true,
      baiduConnected: Boolean(baiduToken),
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

    res.status(201).json({ site: toPublicSite(newSite) });
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
    whitelistedCategories,
    wpUsername,
    wpAppPassword,
    baiduToken,
    googleServiceAccountJson
  } = req.body;

  if (name !== undefined) site.name = String(name).trim();
  if (domain !== undefined && String(domain).trim()) {
    const { isValid, sanitized } = validateDomain(String(domain));
    if (!isValid) {
      throw new ValidationError('域名格式不正确或不允许访问内网地址');
    }
    site.domain = sanitized;
  }
  if (niche !== undefined) site.niche = String(niche).trim();
  if (siteType !== undefined) site.siteType = siteType;
  if (siteLanguage !== undefined) site.siteLanguage = siteLanguage;
  if (whitelistedCategories !== undefined && Array.isArray(whitelistedCategories)) {
    site.whitelistedCategories = whitelistedCategories.filter(c => typeof c === 'string' && c.trim().length > 0);
  }
  if (wpUsername !== undefined) site.wpUsername = wpUsername ? String(wpUsername).trim() : undefined;
  if (wpAppPassword !== undefined) site.wpAppPassword = wpAppPassword ? String(wpAppPassword).trim() : undefined;
  
  if (baiduToken !== undefined) {
    site.baiduToken = baiduToken ? String(baiduToken).trim() : undefined;
    site.baiduConnected = Boolean(site.baiduToken);
  }
  if (googleServiceAccountJson !== undefined) {
    site.googleServiceAccountJson = googleServiceAccountJson ? String(googleServiceAccountJson).trim() : undefined;
    site.gscConnected = Boolean(site.googleServiceAccountJson);
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
    details: '已更新站点配置与收录凭证参数。'
  });

  res.json({ site: toPublicSite(site) });
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
    res.status(404).json({ success: false, message: `站点不存在` });
    return;
  }

  site.autopilotEnabled = !site.autopilotEnabled;
  await fileTenantRepository.saveSite(req.tenantId, site);

  await fileTenantRepository.appendAuditLog(req.tenantId, {
    id: `log-${Date.now()}`,
    siteId: site.id,
    timestamp: new Date().toISOString(),
    actor: 'USER_ADMIN',
    action: 'TOGGLE_AUTOPILOT',
    target: site.name,
    result: 'SUCCESS',
    details: `更新自动发文策略状态为: ${site.autopilotEnabled ? '启用' : '禁用'}`
  });

  res.json({ success: true, site: toPublicSite(site) });
};
