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
  UsdtNetwork,
  ArticleGenerationAutomation,
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

  // Load All Tenant Data & Account/Credits
  const loadTenantData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. 获取当前租户与积分账户及草稿
      const [sitesData, tasksData, meData, txData, draftData] = await Promise.all([
        api.getSites().catch(() => ({ sites: [] })),
        api.getTasks().catch(() => ({ tasks: [] })),
        api.getMe().catch(() => ({ account: null })),
        api.getCreditTransactions().catch(() => ({ transactions: [] })),
        api.getDrafts().catch(() => ({ drafts: [] }))
      ]);

      const loadedSites = sitesData.sites || [];
      setSites(loadedSites);
      setTasks(tasksData.tasks || []);
      setDrafts(draftData.drafts || []);
      if (meData?.account) {
        setAccount(meData.account);
      } else {
        setAccount(null);
      }
      setTransactions(txData.transactions || []);

      if (loadedSites.length > 0) {
        const sid = loadedSites[0].id;
        const [oppRes, metricRes] = await Promise.all([
          api.getOpportunities(sid).catch(() => ({ opportunities: [] })),
          api.getGrowthMetrics(sid).catch(() => ({ metrics: {
            monthlyOrganicVisits: 0,
            monthlyVisitsGrowthPct: 0,
            top10KeywordsCount: 0,
            newTop10KeywordsThisMonth: 0,
            newlyIndexedPagesCount: 0,
            activeAutopilotTasksCount: 0,
            pausedTasksCount: 0
          }}))
        ]);

        setOpportunities(oppRes.opportunities || []);
        setMetrics(metricRes.metrics);
      } else {
        setOpportunities([]);
        setMetrics({
          monthlyOrganicVisits: 0,
          monthlyVisitsGrowthPct: 0,
          top10KeywordsCount: 0,
          newTop10KeywordsThisMonth: 0,
          newlyIndexedPagesCount: 0,
          activeAutopilotTasksCount: 0,
          pausedTasksCount: 0
        });
      }
    } catch (err) {
      console.error("Failed to load tenant data:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadAllTenants = useCallback(async () => {
    try {
      const res = await api.listTenants();
      if (res.tenants) {
        setAllTenants(res.tenants);
      }
    } catch (e) {
      console.error("Failed to load tenants list:", e);
    }
  }, [api]);

  useEffect(() => {
    loadTenantData();
    loadAllTenants();
  }, [loadTenantData, loadAllTenants, activeTenantId]);

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
  }, [api]);

  // Payment / Recharge
  const handleRechargeUsdt = async (usdtAmount: number, txHash?: string, network?: UsdtNetwork, packageId?: string) => {
    const res = await api.rechargeUsdt({ usdtAmount, txHash, network, packageId });
    if (res.success) {
      await loadTenantData();
      return res;
    }
    throw new Error(res.message || '充值失败');
  };

  // Actions
  const handleTriggerScan = async (keyword?: string, siteId?: string) => {
    const defaultKeyword = globalLanguage === 'zh-CN' ? 'DeepSeek K8s 部署实践' : 'Kubernetes FinOps Guide';
    const finalKeyword = keyword || defaultKeyword;
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

    // 前置积分检查
    if (account && account.credits < 20) {
      throw new Error(`当前积分余额 (${account.credits} 积分) 不足 20 积分，请先充值 USDT 兑换积分。`);
    }

    let modeTitle = '雷达自动选题';
    if (keyword?.includes('[二次创作/改写]')) {
      modeTitle = '内容二次创作 / 洗稿降重';
    } else if (keyword?.includes('[竞品对标截流]')) {
      modeTitle = '对标竞品截流';
    } else if (keyword && keyword.trim()) {
      modeTitle = '手动指定关键词';
    }

    addLog(`[准备启动] 模式：【${modeTitle}】· 正在为 ${targetSites.length} 个站点启动 8 阶段全自动生成、质检、发布与推送流程。`);
    setPipelineStep(1, 'RUNNING');

    // These requests intentionally run in sequence: all drafts debit the same
    // tenant credit balance, and the legacy repository does not yet provide a
    // transactional concurrent ledger.
    addLog(`[步骤 1/8 · 意图挖掘] (${modeTitle}) 正在请求 AI 分析目标关键词…`);
    const opps: Opportunity[] = [];
    for (const site of targetSites) {
      const defaultKeyword = keyword || (site.niche && site.niche !== '通用行业' && site.niche !== '通用商业技术'
        ? (site.siteLanguage === 'zh-CN' ? `${site.niche} 核心技术落地与选型指南` : `${site.niche} Architecture Best Practices`)
        : (site.siteLanguage === 'zh-CN' ? 'DeepSeek 企业级私有化微调' : 'Kubernetes FinOps Best Practices'));
      const res = await api.scanOpportunities(site.id, defaultKeyword);
      if (res.opportunity) {
        opps.push(res.opportunity);
      }
    }
    if (!opps.length) throw new Error('没有生成可继续处理的内容机会');
    setPipelineStep(1, 'COMPLETED');

    // Step 2: the brief endpoint first retrieves the customer knowledge sources.
    setPipelineStep(2, 'RUNNING');
    addLog(`[步骤 2/8 · 知识检索] 正在检索站点关联的客户知识库与原创资料…`);
    const briefs: unknown[] = [];
    for (const opp of opps) {
      const briefRes = await api.generateBrief(opp.id);
      briefs.push(briefRes.brief);
    }
    setPipelineStep(2, 'COMPLETED');

    // Step 3 uses the real Content Brief returned in the previous operation.
    setPipelineStep(3, 'RUNNING');
    const briefCount = briefs.filter(Boolean).length;
    addLog(`[步骤 3/8 · 大纲策划] 已返回 ${briefCount}/${opps.length} 份结构化 Content Brief。`);
    setPipelineStep(3, briefCount === opps.length ? 'COMPLETED' : 'PARTIAL');

    // The server performs generation, factual quality gating, internal linking,
    // WordPress publication, and indexing in that order for each article.
    setPipelineStep(4, 'RUNNING');
    addLog(`[步骤 4/8 · 长文智造] (${modeTitle}) 正在生成文章；不合格内容不会进入发布步骤…`);
    const draftsList: ArticleDraft[] = [];
    const automationResults: ArticleGenerationAutomation[] = [];
    for (const opp of opps) {
      const draftRes = await api.generateDraft(opp.id);
      if (draftRes.draft) {
        draftsList.push(draftRes.draft);
      }
      automationResults.push(draftRes.automation);
    }
    setPipelineStep(4, draftsList.length === opps.length ? 'COMPLETED' : 'PARTIAL');

    const qualityPassed = draftsList.filter((draft) => draft.qualityGate.passed).length;
    const qualityFailed = draftsList.length - qualityPassed;
    setPipelineStep(5, 'RUNNING');
    addLog(`[步骤 5/8 · 质量核验] 真实质量门禁：通过 ${qualityPassed} 篇，阻止 ${qualityFailed} 篇。`);
    setPipelineStep(5, qualityFailed === 0 ? 'COMPLETED' : qualityPassed === 0 ? 'FAILED' : 'PARTIAL');

    const insertedInternalLinks = automationResults.filter((result) => result.internalLinking.status === 'INSERTED').length;
    const skippedInternalLinks = automationResults.length - insertedInternalLinks;
    setPipelineStep(6, 'RUNNING');
    addLog(`[步骤 6/8 · 智能内链] 已插入 ${insertedInternalLinks} 篇；无可用目标或已存在链接而跳过 ${skippedInternalLinks} 篇。`);
    setPipelineStep(6, insertedInternalLinks === 0 ? 'SKIPPED' : skippedInternalLinks === 0 ? 'COMPLETED' : 'PARTIAL');

    const publishedDrafts = draftsList.filter((draft) => draft.status === 'PUBLISHED' && draft.publishedUrl);
    const blockedDrafts = draftsList.filter((draft) => draft.status !== 'PUBLISHED');
    setPipelineStep(7, 'RUNNING');
    addLog(`[步骤 7/8 · 站点发布] WordPress 自动发布 ${publishedDrafts.length} 篇；质量门禁阻止 ${blockedDrafts.length} 篇。`);
    setPipelineStep(7, publishedDrafts.length === 0 ? 'SKIPPED' : blockedDrafts.length === 0 ? 'COMPLETED' : 'PARTIAL');

    const indexingResults = automationResults.flatMap((result) => result.indexing.results);
    const submittedIndexing = indexingResults.filter((result) => result.status === 'SUBMITTED').length;
    const failedIndexing = indexingResults.filter((result) => result.status === 'FAILED').length;
    const skippedIndexing = indexingResults.filter((result) => result.status === 'SKIPPED').length;
    setPipelineStep(8, 'RUNNING');
    if (indexingResults.length === 0) {
      addLog('[步骤 8/8 · 引擎推送] 没有已发布文章，未调用搜索引擎推送。');
    } else {
      addLog(`[步骤 8/8 · 引擎推送] 已提交 ${submittedIndexing} 个渠道；跳过 ${skippedIndexing} 个；失败 ${failedIndexing} 个。`);
    }
    await loadTenantData();
    setPipelineStep(
      8,
      indexingResults.length === 0
        ? 'SKIPPED'
        : failedIndexing > 0
          ? submittedIndexing > 0 || skippedIndexing > 0 ? 'PARTIAL' : 'FAILED'
          : submittedIndexing > 0
            ? skippedIndexing > 0 ? 'PARTIAL' : 'COMPLETED'
            : 'SKIPPED'
    );
    return publishedDrafts[0] || draftsList[0];
  };

  const handleAnalyzeCompetitorAttack = async (siteId: string, competitor: string) => {
    if (account && account.credits < 15) {
      throw new Error(`当前积分余额 (${account.credits} 积分) 不足 15 积分，无法执行竞品分析，请先充值 USDT。`);
    }
    const res = await api.analyzeCompetitorAttack(siteId, competitor);
    await loadTenantData();
    return res.analysis;
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
    baiduToken?: string;
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
    if (account && account.credits < 20) {
      throw new Error(`当前积分余额不足 20 积分，无法执行定时任务，请先充值 USDT。`);
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
      handleRechargeUsdt,
      handleTriggerScan,
      handleGenerateBrief,
      handleGenerateDraft,
      handleApprovePublish,
      handleRollback,
      handleRunCruise,
      handleAnalyzeCompetitorAttack,
      handleUpdateSiteById,
      handleDeleteSite,
      handleAddSite,
      handleTestSiteConnection,
      handleCreateTask,
      handleToggleTask,
      handleDeleteTask,
      handleRunTaskNow
    }
  };
}
