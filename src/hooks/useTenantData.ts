import { useState, useEffect, useCallback, useMemo } from 'react';
import { createApiService } from '../services/api';
import {
  WordPressSite,
  SiteType,
  Opportunity,
  ArticleDraft,
  AutomatedTask,
  GrowthMetrics,
  Language,
  TenantAccount,
  CreditTransaction,
  PipelineStepStatus
} from '../types/seo';

export function useTenantData(activeTenantId: string, globalLanguage: Language, onTenantChange?: (newTenantId: string) => void) {
  const [sites, setSites] = useState<WordPressSite[]>([]);
  const [tasks, setTasks] = useState<AutomatedTask[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [drafts, setDrafts] = useState<ArticleDraft[]>([]);
  const [account, setAccount] = useState<TenantAccount | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [allTenants, setAllTenants] = useState<TenantAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [metrics, setMetrics] = useState<GrowthMetrics>({
    monthlyOrganicVisits: 0,
    monthlyVisitsGrowthPct: 0,
    top10KeywordsCount: 0,
    newTop10KeywordsThisMonth: 0,
    newlyIndexedPagesCount: 0,
    activeAutopilotTasksCount: 0,
    pausedTasksCount: 0
  });

  const api = useMemo(() => createApiService(activeTenantId), [activeTenantId]);

  const loadAllTenants = useCallback(async (role?: TenantAccount['role']) => {
    if (role !== 'ADMIN') {
      setAllTenants([]);
      return;
    }
    try {
      const res = await api.listTenants();
      setAllTenants(res.tenants || []);
    } catch (error) {
      console.error('Failed to load tenants list for an authenticated administrator:', error);
      setAllTenants([]);
    }
  }, [api]);

  // Load All Tenant Data & Account/Credits
  const loadTenantData = useCallback(async () => {
    setLoading(true);
    try {
      // Resolve the session first. An anonymous visitor is an expected product
      // state, not a failed dashboard request that should fan out into 401s.
      const meData = await api.getMe().catch((error: any) => {
        if (error?.status === 401) return null;
        throw error;
      });
      if (!meData?.account) {
        setAccount(null);
        setSites([]);
        setTasks([]);
        setOpportunities([]);
        setDrafts([]);
        setTransactions([]);
        setAllTenants([]);
        setMetrics({
          monthlyOrganicVisits: 0,
          monthlyVisitsGrowthPct: 0,
          top10KeywordsCount: 0,
          newTop10KeywordsThisMonth: 0,
          newlyIndexedPagesCount: 0,
          activeAutopilotTasksCount: 0,
          pausedTasksCount: 0
        });
        return;
      }

      const [sitesData, txData, draftData] = await Promise.all([
        api.getSites().catch(() => ({ sites: [] })),
        api.getCreditTransactions().catch(() => ({ transactions: [] })),
        api.getDrafts().catch(() => ({ drafts: [] }))
      ]);

      const loadedSites = sitesData.sites || [];
      setSites(loadedSites);
      setTasks([]);
      setOpportunities([]);
      setDrafts(draftData.drafts || []);
      setAccount(meData.account);
      setTransactions(txData.transactions || []);
      await loadAllTenants(meData.account.role);

      setMetrics({
        monthlyOrganicVisits: 0,
        monthlyVisitsGrowthPct: 0,
        top10KeywordsCount: 0,
        newTop10KeywordsThisMonth: 0,
        newlyIndexedPagesCount: 0,
        activeAutopilotTasksCount: 0,
        pausedTasksCount: 0
      });
    } catch (err) {
      console.error("Failed to load tenant data:", err);
    } finally {
      setLoading(false);
    }
  }, [api, loadAllTenants]);

  useEffect(() => {
    loadTenantData();
  }, [loadTenantData, activeTenantId]);

  // Auth Actions
  const handleLogin = async (usernameOrEmail: string, password?: string) => {
    const res = await api.login(usernameOrEmail, password);
    if (res.success && res.tenantId) {
      api.setTenantId(res.tenantId);
      setAccount(res.account);
      if (onTenantChange) {
        onTenantChange(res.tenantId);
      }
      await loadTenantData();
      return res;
    }
    throw new Error('登录失败');
  };

  const handleRegister = async (data: { username: string; email: string; password?: string; companyName?: string }) => {
    const res = await api.register(data);
    if (res.success && res.tenantId) {
      api.setTenantId(res.tenantId);
      setAccount(res.account);
      if (onTenantChange) {
        onTenantChange(res.tenantId);
      }
      await loadTenantData();
      return res;
    }
    throw new Error('注册失败');
  };

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    api.setAuthToken(null);
    setAccount(null);
    setSites([]);
    setTasks([]);
    setOpportunities([]);
    setDrafts([]);
    setTransactions([]);
    setAllTenants([]);
  }, [api]);

  // Actions
  const handleTriggerScan = async (keyword?: string, siteId?: string) => {
    const finalKeyword = keyword?.trim();
    if (!finalKeyword) throw new Error('请输入需要扫描的真实关键词');
    let created: Opportunity[] = [];

    if (siteId) {
      const res = await api.scanOpportunities(siteId, finalKeyword);
      if (res.opportunity) {
        created.push(res.opportunity);
      }
    } else if (sites.length > 0) {
      const results = await Promise.all(sites.map(s => api.scanOpportunities(s.id, finalKeyword)));
      created = results.map(r => r.opportunity).filter(Boolean);
    }
    await loadTenantData();
    return created;
  };

  const handleGenerateBrief = async (oppId: string) => {
    await api.generateBrief(oppId);
    await loadTenantData();
  };

  const handleGenerateDraft = async (oppId: string) => {
    const res = await api.generateDraft(oppId);
    await loadTenantData();
    return res.draft;
  };

  const handleApprovePublish = async (draftId: string) => {
    await api.approveAndPublishDraft(draftId);
    await loadTenantData();
  };

  const handleRollback = async (draftId: string) => {
    await api.rollbackDraft(draftId);
    await loadTenantData();
  };

  const handleRunCruise = async (
    targetSiteIds: string[],
    addLog: (msg: string) => void,
    setPipelineStep: (step: number, status: PipelineStepStatus) => void,
    keyword?: string
  ) => {
    const targetSites = sites.filter(s => targetSiteIds.includes(s.id));
    if (targetSites.length === 0) return;
    if (account && account.credits < 25) {
      throw new Error(`当前积分余额 (${account.credits} 积分) 不足 25 积分，请先充值 USDT 兑换积分。`);
    }
    const raw = keyword?.trim() || '';
    if (!raw) throw new Error('请提供关键词、二创内容链接或竞品站点');
    const rewritePrefix = '[二次创作/改写]';
    const competitorPrefix = '[竞品对标截流]';
    const source = raw.startsWith(rewritePrefix)
      ? { sourceType: 'REWRITE_URL' as const, sourceValue: raw.slice(rewritePrefix.length).trim(), title: '客户授权内容二创' }
      : raw.startsWith(competitorPrefix)
        ? { sourceType: 'COMPETITOR_URL' as const, sourceValue: raw.slice(competitorPrefix.length).trim(), title: '竞品差异化截流' }
        : { sourceType: 'KEYWORD' as const, sourceValue: raw, title: '关键词内容增长' };
    addLog(`[准备启动] 模式：【${source.title}】· 已创建可恢复、可审计的后台执行单。`);
    setPipelineStep(1, 'RUNNING');
    setPipelineStep(2, 'RUNNING');
    addLog('[步骤 1–5] Worker 正在完成来源抓取、真实关键词数据、内容生成与确定性质量门禁…');
    const result = await api.runAutonomousExecution(targetSites[0].id, source);
    for (const step of [1, 2, 3, 4, 5]) setPipelineStep(step, 'COMPLETED');
    addLog(`[质量核验] 草稿《${result.draft.title}》已通过，执行结果已写入数据库。`);
    const insertedInternalLinks = result.draft.contentHtml.includes('class="aiseo-internal-links"');
    setPipelineStep(6, insertedInternalLinks ? 'COMPLETED' : 'SKIPPED');
    addLog(insertedInternalLinks ? '[智能内链] 已从真实 WordPress 内容清单中插入相关站内链接。' : '[智能内链] 站点暂无语义相关的已发布页面，本次不插入无关链接。');
    const published = result.draft.status === 'PUBLISHED';
    setPipelineStep(7, published ? 'COMPLETED' : 'SKIPPED');
    setPipelineStep(8, published ? 'COMPLETED' : 'SKIPPED');
    addLog(published ? '[发布与监测] 已发布到 WordPress，并创建索引监测。' : '[发布门禁] 草稿已进入人工审核；站点解锁自动发布后，定时任务将自动发布。');
    await loadTenantData();
    return result.draft;
  };

  const handleUpdateSiteById = async (siteId: string, updated: Partial<WordPressSite>) => {
    const res = await api.updateSite(siteId, updated);
    if (res.site) {
      setSites(prev => prev.map(s => s.id === siteId ? res.site : s));
    }
  };

  const handleDeleteSite = async (siteId: string) => {
    await api.deleteSite(siteId);
    setSites(prev => prev.filter(s => s.id !== siteId));
  };

  const handleAddSite = async (siteData: {
    name: string;
    domain: string;
    niche?: string;
    siteType?: SiteType;
    siteLanguage?: Language | string;
    wpUsername?: string;
    wpAppPassword?: string;
  }) => {
    const res = await api.createSite({
      ...siteData,
      niche: siteData.niche || '通用行业',
      siteType: siteData.siteType || 'WORDPRESS',
      siteLanguage: siteData.siteLanguage || 'zh-CN'
    });
    if (res.site) {
      setSites(prev => [res.site, ...prev]);
      await loadTenantData();
    }
  };

  const handleTestSiteConnection = async (siteId: string) => {
    const res = await api.testSiteConnection(siteId);
    if (res.site) {
      setSites(prev => prev.map(s => s.id === siteId ? res.site : s));
    }
    return res.result;
  };

  const handleSetAutopilot = async (siteId: string, enabled: boolean, acceptRisk = false) => {
    const res = await api.setAutopilot(siteId, enabled, acceptRisk);
    setSites((previous) => previous.map((site) => site.id === siteId ? res.site : site));
  };

  const handleGetGrowthStatus = useCallback((siteId: string) => api.getGrowthStatus(siteId), [api]);

  const handleStartGrowth = useCallback(async (siteId: string) => {
    await api.startGrowth(siteId);
    return api.getGrowthStatus(siteId);
  }, [api]);

  const handlePauseGrowth = useCallback(async (siteId: string) => {
    await api.pauseGrowth(siteId);
    return api.getGrowthStatus(siteId);
  }, [api]);

  const handleCreateTask = async (taskData: Partial<AutomatedTask>) => {
    const res = await api.createTask(taskData);
    if (res.task) {
      setTasks(prev => [res.task, ...prev]);
    }
  };

  const handleToggleTask = async (taskId: string, currentStatus: 'ACTIVE' | 'PAUSED') => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const res = await api.updateTask(taskId, { status: nextStatus });
    if (res.task) {
      setTasks(prev => prev.map(t => t.id === taskId ? res.task : t));
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    await api.deleteTask(taskId);
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const handleRunTaskNow = async (taskId: string) => {
    if (account && account.credits < 25) {
      throw new Error('当前积分余额不足 25 积分，无法执行定时任务，请先充值 USDT。');
    }
    const res = await api.runTaskNow(taskId);
    if (res.task) {
      setTasks(prev => prev.map(t => t.id === taskId ? res.task : t));
    }
    await loadTenantData();
    return { success: res.success, message: res.message };
  };

  return {
    sites,
    tasks,
    opportunities,
    drafts,
    metrics,
    account,
    transactions,
    allTenants,
    loading,
    actions: {
      loadTenantData,
      handleLogin,
      handleRegister,
      handleLogout,
      handleTriggerScan,
      handleGenerateBrief,
      handleGenerateDraft,
      handleApprovePublish,
      handleRollback,
      handleRunCruise,
      handleUpdateSiteById,
      handleDeleteSite,
      handleAddSite,
      handleTestSiteConnection,
      handleSetAutopilot,
      handleGetGrowthStatus,
      handleStartGrowth,
      handlePauseGrowth,
      handleCreateTask,
      handleToggleTask,
      handleDeleteTask,
      handleRunTaskNow
    }
  };
}
