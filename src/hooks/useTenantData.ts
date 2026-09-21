import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiService } from '../services/api';
import type {
  WordPressSite,
  SiteType,
  ArticleDraft,
  AutomatedTask,
  Language,
  TenantAccount,
  PipelineStepStatus
} from '../types/seo';
import type { GrowthInput, GrowthRun, GrowthStatus } from '../types/api';
import { ApiError } from '../lib/api';

const EMPTY_SITES: WordPressSite[] = [];
const EMPTY_TASKS: AutomatedTask[] = [];
const EMPTY_DRAFTS: ArticleDraft[] = [];
type CreditTransactions = Awaited<ReturnType<ReturnType<typeof createApiService>['getCreditTransactions']>>['transactions'];
const EMPTY_TRANSACTIONS: CreditTransactions = [];
const EMPTY_TENANTS: TenantAccount[] = [];

export function useTenantData(activeTenantId: string, globalLanguage: Language, onTenantChange?: (newTenantId: string) => void) {
  const queryClient = useQueryClient();
  const api = useMemo(() => createApiService(activeTenantId), [activeTenantId]);
  const workspaceKey = activeTenantId || 'primary';
  void globalLanguage;

  const accountQuery = useQuery({
    queryKey: ['tenant', workspaceKey, 'account'],
    queryFn: async () => api.getMe().catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    })
  });
  const account = accountQuery.data?.account || null;

  useEffect(() => {
    if (!activeTenantId && accountQuery.data?.tenantId) onTenantChange?.(accountQuery.data.tenantId);
  }, [accountQuery.data?.tenantId, activeTenantId, onTenantChange]);

  const sitesQuery = useQuery({ queryKey: ['tenant', workspaceKey, 'sites'], queryFn: () => api.getSites(), enabled: Boolean(account) });
  const draftsQuery = useQuery({
    queryKey: ['tenant', workspaceKey, 'drafts'],
    queryFn: () => api.getDrafts(),
    enabled: Boolean(account),
    refetchInterval: (query) => query.state.data?.drafts.some(({ status }) => status === 'PUBLISHING' || status === 'ROLLING_BACK') ? 3_000 : false
  });
  const tasksQuery = useQuery({ queryKey: ['tenant', workspaceKey, 'growth-programs'], queryFn: () => api.getTasks(), enabled: Boolean(account) });
  const transactionsQuery = useQuery({ queryKey: ['tenant', workspaceKey, 'ledger'], queryFn: () => api.getCreditTransactions(), enabled: Boolean(account) });
  const tenantsQuery = useQuery({ queryKey: ['tenant', workspaceKey, 'admin-organizations'], queryFn: () => api.listTenants(), enabled: account?.role === 'ADMIN' });

  const sites = sitesQuery.data?.sites || EMPTY_SITES;
  const drafts = draftsQuery.data?.drafts || EMPTY_DRAFTS;
  const tasks = tasksQuery.data?.tasks || EMPTY_TASKS;
  const transactions = transactionsQuery.data?.transactions || EMPTY_TRANSACTIONS;
  const allTenants = tenantsQuery.data?.tenants || EMPTY_TENANTS;
  const growthStatusQuery = useQuery({
    queryKey: ['tenant', workspaceKey, 'growth-status', sites.map(({ id }) => id).join(',')],
    queryFn: async () => Promise.all(sites.map(async (site) => ({ siteId: site.id, status: await api.getGrowthStatus(site.id) }))),
    enabled: Boolean(account) && sites.length > 0,
    refetchInterval: (query) => {
      const rows = query.state.data as Array<{ siteId: string; status: GrowthStatus }> | undefined;
      const active = rows?.some(({ status }) => status.run && ['QUEUED', 'RUNNING'].includes(status.run.status));
      return active ? 3_000 : 60_000;
    }
  });
  const growthStatuses = useMemo(() => Object.fromEntries(
    (growthStatusQuery.data || []).map(({ siteId, status }) => [siteId, status])
  ) as Record<string, GrowthStatus>, [growthStatusQuery.data]);
  const loading = accountQuery.isLoading || (Boolean(account) && [sitesQuery, draftsQuery, tasksQuery, transactionsQuery].some((query) => query.isLoading));
  const refreshing = !loading && [accountQuery, sitesQuery, draftsQuery, tasksQuery, transactionsQuery, tenantsQuery, growthStatusQuery]
    .some((query) => query.isFetching);
  const loadError = [accountQuery, sitesQuery, draftsQuery, tasksQuery, transactionsQuery, tenantsQuery, growthStatusQuery]
    .find((query) => query.isError)?.error;

  const invalidateTenantResources = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tenant'] });
  }, [queryClient]);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    queryClient.removeQueries({ queryKey: ['tenant'] });
  }, [api, queryClient]);

  const handleApprovePublish = async (draftId: string) => {
    await api.approvePublishDraft(draftId);
    await invalidateTenantResources();
  };

  const handleRejectDraft = async (draftId: string, comment: string) => {
    await api.rejectDraft(draftId, comment);
    await invalidateTenantResources();
  };

  const handleRetryPublish = async (draftId: string) => {
    await api.retryPublishDraft(draftId);
    await invalidateTenantResources();
  };

  const handleRollback = async (draftId: string) => {
    await api.rollbackDraft(draftId);
    await invalidateTenantResources();
  };

  const handleStartGrowthProgram = async (
    targetSiteIds: string[],
    addLog: (message: string) => void,
    setPipelineStep: (step: number, status: PipelineStepStatus) => void,
    inputs?: GrowthInput[]
  ) => {
    const targetSites = sites.filter((site) => targetSiteIds.includes(site.id));
    if (!targetSites.length) return undefined;
    addLog('[准备启动] 已创建可恢复、可审计的自然流量增长程序。');
    const stageNumbers = { UNDERSTAND: 1, DISCOVER: 2, DECIDE: 3, EXECUTE: 4, LEARN: 5 } as const;
    const observed = new Map<string, string>();
    const onProgress = (run: GrowthRun) => {
      for (const stage of run.stages) {
        const status: PipelineStepStatus = stage.status === 'BLOCKED' || stage.status === 'FAILED'
          ? 'FAILED'
          : stage.status === 'SKIPPED' ? 'SKIPPED' : stage.status;
        setPipelineStep(stageNumbers[stage.stage], status);
        const fingerprint = `${stage.status}:${stage.updatedAt || stage.finishedAt || stage.startedAt || ''}:${stage.summary || ''}`;
        if (stage.summary && observed.get(stage.stage) !== fingerprint) {
          observed.set(stage.stage, fingerprint);
          addLog(`[${stageNumbers[stage.stage]}/5 ${stage.stage}] ${stage.summary}`);
        }
      }
    };
    const result = await api.createGrowthProgram(targetSites[0].id, 'ONCE', inputs || [], onProgress);
    addLog(`[任务已入队] 运行 ${result.run.id} 已持久化，可以刷新页面或稍后回来继续查看。`);
    await invalidateTenantResources();
    return result.draft;
  };

  const handleUpdateSiteById = async (siteId: string, updated: Partial<WordPressSite>) => {
    const result = await api.updateSite(siteId, updated);
    await invalidateTenantResources();
    return result.site;
  };

  const handleDeleteSite = async (siteId: string) => {
    await api.deleteSite(siteId);
    await invalidateTenantResources();
  };

  const handleAddSite = async (siteData: { name: string; domain: string; niche?: string; siteType?: SiteType; siteLanguage?: Language }) => {
    const result = await api.createSite({ ...siteData, siteType: siteData.siteType || 'WORDPRESS', siteLanguage: siteData.siteLanguage || 'zh-CN' });
    await queryClient.invalidateQueries({ queryKey: ['tenant', workspaceKey, 'sites'] });
    return result.site;
  };

  const handleAuthorizeWordPress = (siteId: string) => api.authorizeWordPress(siteId);

  const handleTestSiteConnection = async (siteId: string) => {
    const result = await api.testSiteConnection(siteId);
    await queryClient.invalidateQueries({ queryKey: ['tenant', workspaceKey, 'sites'] });
    return result.result;
  };

  const handleCreateTask = async (taskData: Partial<AutomatedTask>) => {
    await api.createTask(taskData);
    await queryClient.invalidateQueries({ queryKey: ['tenant', workspaceKey, 'growth-programs'] });
  };

  const handleToggleTask = async (taskId: string, currentStatus: 'ACTIVE' | 'PAUSED') => {
    await api.updateTask(taskId, { status: currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
    await queryClient.invalidateQueries({ queryKey: ['tenant', workspaceKey, 'growth-programs'] });
  };

  const handleRunTaskNow = async (taskId: string) => {
    const result = await api.runTaskNow(taskId);
    await invalidateTenantResources();
    return { success: result.success, message: result.message };
  };

  return {
    sites, tasks, drafts, account, transactions, allTenants, growthStatuses, loading, refreshing, loadError,
    actions: {
      loadTenantData: invalidateTenantResources,
      handleLogout,
      handleApprovePublish,
      handleRejectDraft,
      handleRetryPublish,
      handleRollback,
      handleStartGrowthProgram,
      handleUpdateSiteById,
      handleDeleteSite,
      handleAddSite,
      handleAuthorizeWordPress,
      handleTestSiteConnection,
      handleCreateTask,
      handleToggleTask,
      handleRunTaskNow
    }
  };
}
