import {
  WordPressSite,
  SiteType,
  Opportunity,
  ArticleDraft,
  AutomatedTask,
  GrowthMetrics,
  Language,
  ArticleGenerationAutomation,
  TenantAccount,
  CreditTransaction,
  UsdtPackage,
} from "../types/seo";
import { api as productionApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Draft, ExecutionRun, GrowthStatus, JobRun, KnowledgeSource as ProductionKnowledgeSource, Ledger, Me, Opportunity as ProductionOpportunity, Site as ProductionSite } from '../types/api';

type ProductionTask = {
  id: string; siteId: string; name: string; scheduleType: 'DAILY' | 'INTERVAL' | 'WEEKLY';
  scheduleConfig: { sourceType?: 'KEYWORD' | 'REWRITE_URL' | 'COMPETITOR_URL'; sourceValue?: string; minutes?: number }; status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  lastRunAt?: string; nextRunAt: string; createdAt: string;
};

const microsToCredits = (value: string | bigint | number | undefined): number => Number(BigInt(value || 0)) / 1_000_000;

const toLegacySite = (site: ProductionSite): WordPressSite => ({
  id: site.id,
  name: site.name,
  domain: site.domain,
  niche: '未设置',
  siteType: 'WORDPRESS',
  siteLanguage: site.language,
  pagesCount: 0,
  connectorStatus: site.wordpressStatus === 'CONNECTED' ? 'CONNECTED' : site.wordpressStatus === 'VERIFYING' ? 'CHECKING' : site.wordpressStatus === 'FAILED' ? 'ERROR' : 'DISCONNECTED',
  wpUsername: site.wordpressUser,
  pluginInstalled: site.wordpressStatus === 'CONNECTED',
  whitelistedCategories: [],
  gscConnected: site.integrations.some((item) => item.provider === 'GSC' && item.status === 'CONNECTED'),
  gscPropertyId: site.integrations.find((item) => item.provider === 'GSC')?.propertyId,
  gscStatus: site.integrations.find((item) => item.provider === 'GSC')?.status,
  gscLastSyncedAt: site.integrations.find((item) => item.provider === 'GSC')?.lastSyncedAt,
  gscLastErrorMessage: site.integrations.find((item) => item.provider === 'GSC')?.lastErrorMessage,
  ga4Connected: false,
  calibration: {
    isCalibrating: site.manualPublishSuccesses < 3,
    daysRemaining: 0,
    totalApprovedRequired: 3,
    approvedCount: site.manualPublishSuccesses,
    rejectedCount: 0,
    zeroFactErrorStreak: site.manualPublishSuccesses,
    autoPublishUnlocked: Boolean(site.autoPublishEnabledAt)
  },
  autopilotEnabled: Boolean(site.autoPublishEnabledAt),
  createdAt: site.createdAt
});

const toLegacyDraft = (draft: Draft): ArticleDraft => ({
  id: draft.id,
  opportunityId: draft.opportunityId || '',
  siteId: draft.siteId,
  title: draft.title,
  language: 'zh-CN',
  category: '未分类',
  contentHtml: draft.html,
  summary: draft.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
  sourcesUsed: draft.knowledgeSourceIds || [],
  qualityGate: {
    passed: Boolean(draft.qualityReport?.passed),
    overallScore: Number(draft.qualityReport?.score || 0),
    factReliabilityScore: 0,
    hallucinationFree: Boolean(draft.qualityReport?.passed),
    languageMatch: true,
    sourceCheckPassed: Boolean(draft.qualityReport?.passed),
    duplicateContentCheck: Boolean(draft.qualityReport?.passed),
    issues: draft.qualityReport?.issues || [],
    passedChecks: draft.qualityReport?.passedChecks || (draft.qualityReport?.passed ? ['deterministic-quality-gate'] : [])
  },
  status: draft.status === 'PUBLISHED' ? 'PUBLISHED' : draft.status === 'ROLLED_BACK' ? 'ROLLED_BACK' : draft.status === 'PENDING_REVIEW' || draft.status === 'APPROVED' || draft.status === 'PUBLISHING' ? 'PENDING_APPROVAL' : draft.status === 'QUALITY_FAILED' ? 'QUALITY_FAILED' : draft.qualityReport?.passed ? 'QUALITY_PASSED' : 'DRAFT',
  publishedUrl: draft.publishedUrl,
  createdAt: draft.createdAt || new Date().toISOString()
});

const toLegacyTask = (task: ProductionTask, sites: WordPressSite[]): AutomatedTask => ({
  id: task.id,
  siteId: task.siteId,
  siteName: sites.find((site) => site.id === task.siteId)?.name || '未知站点',
  taskName: task.name,
  scheduleType: task.scheduleType,
  scheduleTime: task.scheduleType === 'INTERVAL'
    ? String(Math.max(1, Math.round((task.scheduleConfig.minutes || 60) / 60)))
    : new Date(task.nextRunAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
  targetKeywordTopic: task.scheduleConfig.sourceValue || '',
  sourceType: task.scheduleConfig.sourceType,
  articleCountPerRun: 1,
  status: task.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
  lastRunAt: task.lastRunAt,
  nextRunAt: task.nextRunAt,
  createdAt: task.createdAt
});

const toLegacyOpportunity = (item: ProductionOpportunity): Opportunity => ({
  id: item.id,
  siteId: item.siteId,
  title: item.keyword || item.title,
  type: 'NEW_CONTENT',
  language: 'zh-CN',
  targetKeyword: item.keyword || item.title,
  category: '关键词机会',
  riskLevel: (item.keywordDifficulty ?? 0) >= 70 ? 'HIGH' : (item.keywordDifficulty ?? 0) >= 40 ? 'MEDIUM' : 'LOW',
  estimatedMonthlyVisitsGain: item.searchVolume ?? 0,
  demandEvidence: {
    sourceType: 'CONTENT_GAP',
    queryOrTopic: item.keyword || item.title,
    monthlyImpressions: item.searchVolume ?? 0,
    evidenceDescription: `DataForSEO snapshot · KD ${item.keywordDifficulty ?? '未采集'} · allintitle ${item.allintitleCount ?? '未采集'}`,
    reliabilityConfidence: 1
  },
  scoreBreakdown: {
    totalScore: Number(BigInt(item.roiScoreMicros || '0')) / 1_000_000,
    businessValue: 0,
    searchDemand: item.searchVolume ?? 0,
    winProbability: item.keywordDifficulty == null ? 0 : Math.max(0, 100 - item.keywordDifficulty),
    currentRanking: 0,
    engagementPotential: 0,
    googleBaiduReuse: 0,
    internalLinkValue: 0,
    freshness: 0,
    dataReliability: 100,
    riskPenalty: 0,
    costPenalty: 0
  },
  status: item.status === 'OPEN' ? 'PROPOSED' : 'APPROVED',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

export class ApiService {
  private organizationId = '';
  private me?: Me;

  constructor(tenantId?: string) { this.organizationId = tenantId || ''; }

  private async resolveWorkspace(): Promise<{ me: Me; organizationId: string }> {
    if (!this.me || !this.organizationId) {
      this.me = (await productionApi.get<Me>('/me')).data;
      this.organizationId = this.me.organizations[0]?.id || '';
    }
    if (!this.organizationId) throw new Error('个人工作区尚未完成初始化');
    return { me: this.me, organizationId: this.organizationId };
  }

  private async waitForJob(jobId: string, timeoutMs = 180_000): Promise<JobRun> {
    const { organizationId } = await this.resolveWorkspace();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = (await productionApi.get<JobRun>(`/organizations/${organizationId}/jobs/${jobId}`)).data;
      if (job.status === 'SUCCEEDED') return job;
      if (job.status === 'FAILED' || job.status === 'DEAD_LETTER') {
        throw new Error(job.errorMessage || '后台任务执行失败');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    throw new Error('后台任务仍在处理中，请稍后到任务记录查看结果');
  }

  public setTenantId(tenantId: string) {
    this.organizationId = tenantId;
  }

  public setAuthToken(token: string | null) {
    // Browser sessions are HttpOnly cookies. This method remains as a compatibility no-op.
    void token;
  }

  public getAuthToken(): string | null {
    return null;
  }

  // Auth & Tenant
  public login(usernameOrEmail: string, password?: string) {
    return supabase.auth.signInWithPassword({ email: usernameOrEmail, password: password || '' }).then(async ({ error }) => {
      if (error) throw error;
      return this.getMe();
    });
  }

  public register(data: { username: string; email: string; password?: string; companyName?: string }) {
    return supabase.auth.signUp({ email: data.email, password: data.password || '', options: { data: { display_name: data.username } } }).then(async ({ data: result, error }) => {
      if (error) throw error;
      if (!result.session) throw new Error('注册成功，请先验证邮箱后登录');
      return this.getMe();
    });
  }

  public async getMe() {
    const { me, organizationId } = await this.resolveWorkspace();
    const organization = me.organizations.find((item) => item.id === organizationId) || me.organizations[0];
    return {
      success: true,
      tenantId: organization.id,
      account: {
        id: me.profile.id,
        username: me.profile.displayName || me.profile.email.split('@')[0],
        email: me.profile.email,
        companyName: organization.name,
        credits: microsToCredits(organization.creditBalanceMicros),
        totalRechargedUsdt: 0,
        totalConsumedCredits: 0,
        role: me.profile.platformRole === 'PLATFORM_ADMIN' ? 'ADMIN' : 'TENANT',
        createdAt: new Date().toISOString()
      } satisfies TenantAccount
    };
  }

  public async logout() {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) throw error;
  }

  public async listTenants() {
    const { me } = await this.resolveWorkspace();
    if (me.profile.platformRole !== 'PLATFORM_ADMIN') return { success: true, tenants: [] };
    const organizations = (await productionApi.get<Array<{ id: string; name: string; creditBalanceMicros: string; createdAt: string }>>('/admin/organizations')).data;
    return { success: true, tenants: organizations.map((organization) => ({ id: organization.id, username: organization.name, email: '', companyName: organization.name, credits: microsToCredits(organization.creditBalanceMicros), totalRechargedUsdt: 0, totalConsumedCredits: 0, role: 'TENANT' as const, createdAt: organization.createdAt })) };
  }

  // Credit & USDT Payment
  public async getCreditConfig() {
    const { me } = await this.resolveWorkspace();
    const endpoint = me.profile.platformRole === 'PLATFORM_ADMIN' ? '/admin/pricing' : '/pricing';
    const pricing = (await productionApi.get<{ packages: Array<{ id: string; name: string; baseAmountMicros: string; creditMicros: string; active: boolean }>; actions: Array<{ action: string; name: string; description: string; creditMicros: string; active: boolean }> }>(endpoint)).data;
    return {
      success: true,
      rate: '链上精确金额',
      trc20Address: '',
      wallets: {},
      packages: pricing.packages.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, usdtAmount: Number(BigInt(item.baseAmountMicros)) / 1_000_000, credits: microsToCredits(item.creditMicros) })),
      actionPricing: pricing.actions.map((item) => ({ action: item.action, name: item.name, credits: microsToCredits(item.creditMicros), desc: item.description, enabled: item.active })),
      paymentAvailable: pricing.packages.some((item) => item.active),
      paymentNotice: '创建充值订单后显示唯一 TRC20 应付金额与收款地址。'
    };
  }

  public async updatePricingConfig(data: {
    rate?: string;
    trc20Address?: string;
    actionPricing?: Array<{ action: string; name: string; credits: number; desc: string; enabled?: boolean }>;
    packages?: UsdtPackage[];
  }) {
    const current = (await productionApi.get<{ packages: Array<{ id: string; name: string; baseAmountMicros: string; creditMicros: string; active: boolean; sortOrder: number }>; actions: unknown[] }>('/admin/pricing')).data;
    const submittedIds = new Set((data.packages || []).map(({ id }) => id));
    const packageRequests = (data.packages || []).map((item, sortOrder) => productionApi.put(`/admin/pricing/packages/${encodeURIComponent(item.id)}`, { name: item.name, baseAmountMicros: String(Math.round(item.usdtAmount * 1_000_000)), creditMicros: String(Math.round(item.credits * 1_000_000)), active: true, sortOrder }));
    const deactivateRequests = current.packages.filter(({ id, active }) => active && !submittedIds.has(id)).map((item) => productionApi.put(`/admin/pricing/packages/${encodeURIComponent(item.id)}`, { name: item.name, baseAmountMicros: item.baseAmountMicros, creditMicros: item.creditMicros, active: false, sortOrder: item.sortOrder }));
    const actionRequests = (data.actionPricing || []).map((item) => productionApi.put(`/admin/pricing/actions/${encodeURIComponent(item.action)}`, { name: item.name, description: item.desc, creditMicros: String(Math.round(item.credits * 1_000_000)), active: item.enabled !== false }));
    await Promise.all([...packageRequests, ...deactivateRequests, ...actionRequests]);
    return { success: true, message: '定价已写入正式数据库并记录审计事件', config: data };
  }

  public async getCreditTransactions() {
    const { organizationId } = await this.resolveWorkspace();
    const ledger = (await productionApi.get<Ledger>(`/organizations/${organizationId}/ledger?limit=100`)).data;
    return { success: true, transactions: ledger.entries.map((entry) => ({ id: entry.id, tenantId: organizationId, type: BigInt(entry.amountMicros) >= 0n ? 'RECHARGE' as const : 'CONSUME' as const, action: entry.type as CreditTransaction['action'], amount: microsToCredits(entry.amountMicros), balance: microsToCredits(entry.balanceAfterMicros), description: entry.reason, createdAt: entry.createdAt, status: 'CONFIRMED' as const, metadata: {} as CreditTransaction['metadata'] })) };
  }

  public async createPaymentIntent(packageId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ paymentIntent: { id: string; packageId: string; recipientAddress: string; expectedAmountMicros: string; creditMicros: string; status: string; expiresAt: string; createdAt: string } }>(`/organizations/${organizationId}/payment-intents`, { packageId })).data.paymentIntent;
  }

  public async submitPaymentTransaction(paymentIntentId: string, txHash: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ paymentIntent: { id: string; status: string } }>(`/organizations/${organizationId}/payment-intents/${paymentIntentId}/submit-transaction`, { txHash })).data.paymentIntent;
  }

  public async getAllTransactions() {
    const payments = (await productionApi.get<Array<{ id: string; organizationId: string; expectedAmountMicros: string; creditMicros: string; txHash?: string; status: string; createdAt: string }>>('/admin/payments')).data;
    return { success: true, transactions: payments.map((payment) => ({ id: payment.id, tenantId: payment.organizationId, type: 'RECHARGE' as const, action: 'USDT_TOPUP' as const, amount: microsToCredits(payment.creditMicros), balance: 0, description: 'TRC20 USDT 充值', createdAt: payment.createdAt, txHash: payment.txHash, usdtAmount: Number(BigInt(payment.expectedAmountMicros)) / 1_000_000, network: 'TRC20' as const, status: payment.status === 'CREDITED' ? 'CONFIRMED' as const : payment.status === 'REJECTED' || payment.status === 'EXPIRED' ? 'REJECTED' as const : 'PENDING' as const })) };
  }

  public async getAllUsages() {
    const usages = (await productionApi.get<Array<{ id: string; organizationId: string; action: string; amountMicros: string; resultId?: string; createdAt: string }>>('/admin/usage')).data;
    return { success: true, usages: usages.map((usage) => ({ id: usage.id, tenantId: usage.organizationId, action: usage.action, actionName: usage.action, creditsDeducted: microsToCredits(usage.amountMicros), remainingCredits: 0, createdAt: usage.createdAt, description: usage.resultId ? `交付结果 ${usage.resultId}` : '已结算业务用量' })) } as { success: boolean; usages: Array<{
      id: string;
      tenantId: string;
      siteId?: string;
      taskId?: string;
      action: string;
      actionName: string;
      creditsDeducted: number;
      remainingCredits: number;
      createdAt: string;
      description?: string;
    }> };
  }

  public async adjustTenantCredits(targetTenantId: string, deltaCredits: number, reason: string) {
    const result = (await productionApi.post<{ organization: { creditBalanceMicros: string }; entry: { id: string; createdAt: string } }>(`/admin/organizations/${targetTenantId}/adjustment`, { amountMicros: String(Math.round(deltaCredits * 1_000_000)), reason })).data;
    return { success: true, message: '积分调整已追加到账本', balance: microsToCredits(result.organization.creditBalanceMicros), account: {} as TenantAccount, transaction: { id: result.entry.id } as CreditTransaction };
  }

  public async getProviderStatus() {
    const providers = (await productionApi.get<Record<string, boolean | string | number | null | undefined>>('/admin/provider-status')).data;
    return { providers };
  }

  // Sites
  public async getSites() {
    const { organizationId } = await this.resolveWorkspace();
    const sites = (await productionApi.get<ProductionSite[]>(`/organizations/${organizationId}/sites`)).data;
    return { sites: sites.map(toLegacySite) };
  }

  public async testSiteConnection(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ connected: boolean; user?: string; capabilities?: unknown }>(`/organizations/${organizationId}/sites/${siteId}/test-connection`, {})).data;
    const site = (await productionApi.get<ProductionSite[]>(`/organizations/${organizationId}/sites`)).data.find((item) => item.id === siteId);
    if (!site) throw new Error('站点连接已测试，但站点记录不存在');
    return { result, site: toLegacySite(site) };
  }

  public async createSite(data: {
    name: string;
    domain: string;
    niche: string;
    siteType?: SiteType;
    siteLanguage: Language | string;
    wpUsername?: string;
    wpAppPassword?: string;
    wpRestEndpoint?: string;
  }) {
    const { organizationId } = await this.resolveWorkspace();
    if (data.siteType && data.siteType !== 'WORDPRESS') throw new Error('当前正式版本仅支持 WordPress');
    const created = (await productionApi.post<{ site: ProductionSite }>(`/organizations/${organizationId}/sites`, { name: data.name, domain: data.domain, language: data.siteLanguage === 'en' ? 'en-US' : data.siteLanguage })).data.site;
    if (data.wpUsername && data.wpAppPassword) await productionApi.put(`/organizations/${organizationId}/sites/${created.id}/wordpress-credentials`, { username: data.wpUsername, applicationPassword: data.wpAppPassword });
    return { site: toLegacySite(created) };
  }

  public async updateSite(siteId: string, updated: Partial<WordPressSite>) {
    const { organizationId } = await this.resolveWorkspace();
    const payload = { name: updated.name, domain: updated.domain, language: updated.siteLanguage }.valueOf();
    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    await productionApi.put(`/organizations/${organizationId}/sites/${siteId}`, cleanPayload);
    if (updated.wpUsername && updated.wpAppPassword) {
      await productionApi.put(`/organizations/${organizationId}/sites/${siteId}/wordpress-credentials`, { username: updated.wpUsername, applicationPassword: updated.wpAppPassword });
    }
    const site = (await productionApi.get<ProductionSite[]>(`/organizations/${organizationId}/sites`)).data.find((item) => item.id === siteId);
    if (!site) throw new Error('站点更新后无法读取');
    return { site: toLegacySite(site) };
  }

  public async deleteSite(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.delete(`/organizations/${organizationId}/sites/${siteId}`);
    return { success: true, deletedId: siteId };
  }

  public async setAutopilot(siteId: string, enabled: boolean, acceptRisk = false) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ site: ProductionSite }>(`/organizations/${organizationId}/sites/${siteId}/auto-publish`, { enabled, acceptRisk })).data;
    return { site: toLegacySite(result.site) };
  }

  public async authorizeGsc(siteId: string, propertyId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ authorizationUrl: string }>(`/organizations/${organizationId}/sites/${siteId}/gsc/authorize`, { propertyId })).data;
  }

  public async syncGsc(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * 60 * 60_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    return (await productionApi.post<{ job: { id: string } }>(`/organizations/${organizationId}/sites/${siteId}/gsc/sync`, { startDate: date(start), endDate: date(end) })).data;
  }

  public async disconnectGsc(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.delete(`/organizations/${organizationId}/sites/${siteId}/gsc`);
  }

  // Opportunities
  public async getOpportunities(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const items = (await productionApi.get<ProductionOpportunity[]>(`/organizations/${organizationId}/opportunities?limit=100`)).data;
    // The legacy keyword view only understands DataForSEO keyword records.
    // Growth-state opportunities use a separate evidence-first projection and
    // must not be coerced into fake keyword metrics.
    return { opportunities: items.filter((item) => item.siteId === siteId && item.keyword && item.searchVolume != null && item.keywordDifficulty != null).map(toLegacyOpportunity) };
  }

  public async getGrowthStatus(siteId: string): Promise<GrowthStatus> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<GrowthStatus>(`/organizations/${organizationId}/sites/${siteId}/growth`)).data;
  }

  public async startGrowth(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ phase: 'ANALYZING_REALITY' | 'SYNCING_REALITY'; job: JobRun }>(`/organizations/${organizationId}/sites/${siteId}/growth/start`, {})).data;
  }

  public async pauseGrowth(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ state: GrowthStatus['state'] }>(`/organizations/${organizationId}/sites/${siteId}/growth/pause`, {})).data;
  }

  public async runAutonomousExecution(siteId: string, source: { sourceType: 'KEYWORD' | 'REWRITE_URL' | 'COMPETITOR_URL'; sourceValue: string }) {
    const { organizationId } = await this.resolveWorkspace();
    const created = (await productionApi.post<{ execution: ExecutionRun; job: JobRun }>(`/organizations/${organizationId}/executions`, { siteId, source })).data;
    await this.waitForJob(created.job.id, 300_000);
    const publishDeadline = Date.now() + 120_000;
    let execution = created.execution;
    while (Date.now() < publishDeadline) {
      const executions = (await productionApi.get<ExecutionRun[]>(`/organizations/${organizationId}/executions?limit=100`)).data;
      execution = executions.find((item) => item.id === created.execution.id) || execution;
      if (execution.status !== 'PUBLISHING') break;
      await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    }
    if (execution.status === 'FAILED') throw new Error(execution.errorMessage || '全自动执行未完成');
    if (execution.status === 'PUBLISHING') throw new Error('WordPress 仍在发布中，请稍后到“我的内容”查看结果');
    const drafts = (await productionApi.get<Draft[]>(`/organizations/${organizationId}/drafts`)).data;
    const draft = execution.draftId ? drafts.find((item) => item.id === execution.draftId) : undefined;
    if (!draft) throw new Error('执行已结束，但没有生成可交付草稿');
    return { execution, draft: toLegacyDraft(draft) };
  }

  public async scanOpportunities(siteId: string, keyword?: string) {
    const { organizationId } = await this.resolveWorkspace();
    const seedKeyword = keyword?.trim();
    if (!seedKeyword) throw new Error('请输入需要扫描的真实关键词');
    const result = (await productionApi.post<{ scan: { id: string }; job: { id: string } }>(`/organizations/${organizationId}/keyword-scans`, { siteId, seedKeyword })).data;
    const completed = await this.waitForJob(result.job.id);
    const opportunityId = completed.result?.resultId;
    const opportunities = (await productionApi.get<ProductionOpportunity[]>(`/organizations/${organizationId}/opportunities?limit=100`)).data;
    const opportunity = opportunities.find((item) => item.id === opportunityId)
      || opportunities.find((item) => item.siteId === siteId && item.keyword === keyword);
    if (!opportunity) throw new Error('关键词扫描已完成，但未返回可用机会');
    return { opportunity: toLegacyOpportunity(opportunity), scan: result.scan, job: completed };
  }

  public async serpScan(data: { seedKeyword: string; siteId?: string; location?: string }) {
    const sites = await this.getSites();
    const siteId = data.siteId || sites.sites[0]?.id;
    if (!siteId) throw new Error('请先添加 WordPress 站点');
    const { opportunity } = await this.scanOpportunities(siteId, data.seedKeyword);
    const volume = Math.max(0, opportunity.demandEvidence.monthlyImpressions || 0);
    const allintitleMatch = opportunity.demandEvidence.evidenceDescription.match(/allintitle\s+(\d+)/i);
    const allintitle = Number(allintitleMatch?.[1] || 0);
    const kdMatch = opportunity.demandEvidence.evidenceDescription.match(/KD\s+(\d+)/i);
    const kd = Number(kdMatch?.[1] || 0);
    return {
      success: true,
      source: 'DATAFORSEO',
      opportunities: [{
        id: opportunity.id,
        keyword: opportunity.targetKeyword,
        searchVolume: volume,
        kd,
        kgrIndex: volume > 0 ? allintitle / volume : 0,
        serpVulnerabilityScore: Math.max(0, 100 - kd),
        commercialIntentScore: 0,
        roiScore: opportunity.scoreBreakdown.totalScore,
        vulnerabilityType: 'KGR_GOLD',
        vulnerabilityLabel: 'KGR 真实数据机会',
        serpWeaknesses: [`DataForSEO allintitle: ${allintitle}`, `关键词难度: ${kd}`],
        recommendedTitle: opportunity.title,
        recommendedAngle: '根据真实搜索快照与客户知识来源生成',
        recommendedH2s: [],
        searchIntent: 'INFORMATIONAL'
      }]
    };
  }

  public async generateBrief(oppId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const opportunities = (await productionApi.get<ProductionOpportunity[]>(`/organizations/${organizationId}/opportunities?limit=100`)).data;
    const opportunity = opportunities.find((item) => item.id === oppId);
    if (!opportunity) throw new Error('内容机会不存在');
    const sources = (await productionApi.get<ProductionKnowledgeSource[]>(`/organizations/${organizationId}/knowledge-sources?siteId=${opportunity.siteId}`)).data;
    if (!sources.length) throw new Error('请先为该站点添加至少一个真实知识来源');
    return { brief: { opportunityId: oppId, knowledgeSourceIds: sources.slice(0, 20).map(({ id }) => id), sourceCount: sources.length }, opportunity: toLegacyOpportunity(opportunity) };
  }

  public async generateArticle(oppId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const opportunities = (await productionApi.get<ProductionOpportunity[]>(`/organizations/${organizationId}/opportunities?limit=100`)).data;
    const opportunity = opportunities.find((item) => item.id === oppId);
    if (!opportunity) throw new Error('内容机会不存在');
    const sources = (await productionApi.get<ProductionKnowledgeSource[]>(`/organizations/${organizationId}/knowledge-sources?siteId=${opportunity.siteId}`)).data;
    if (!sources.length) throw new Error('请先为该站点添加至少一个真实知识来源');
    const created = (await productionApi.post<{ job: { id: string } }>(`/organizations/${organizationId}/content-runs`, { siteId: opportunity.siteId, opportunityId: oppId, knowledgeSourceIds: sources.slice(0, 20).map(({ id }) => id) })).data;
    const completed = await this.waitForJob(created.job.id);
    const draftId = completed.result?.resultId;
    const drafts = (await productionApi.get<Draft[]>(`/organizations/${organizationId}/drafts`)).data;
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error('内容任务已完成，但未返回草稿');
    return {
      draft: toLegacyDraft(draft),
      opportunity: toLegacyOpportunity(opportunity),
      automation: {
        internalLinking: { status: 'SKIPPED', message: '当前草稿未生成可验证的内链插入记录' },
        publishing: { status: 'BLOCKED', message: '草稿已进入人工审核，尚未发布' },
        indexing: { status: 'SKIPPED', results: [] }
      } satisfies ArticleGenerationAutomation
    };
  }

  public generateDraft(oppId: string) {
    return this.generateArticle(oppId);
  }

  // Drafts
  public async getDrafts() {
    const { organizationId } = await this.resolveWorkspace();
    const drafts = (await productionApi.get<Draft[]>(`/organizations/${organizationId}/drafts`)).data;
    return { drafts: drafts.map(toLegacyDraft) };
  }

  public async approvePublishDraft(draftId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.post(`/organizations/${organizationId}/drafts/${draftId}/approve`, {});
    const published = (await productionApi.post<{ job: { id: string } }>(`/organizations/${organizationId}/drafts/${draftId}/publish`, {})).data;
    await this.waitForJob(published.job.id);
    const drafts = (await this.getDrafts()).drafts;
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error('发布完成，但未找到对应文章记录');
    return { draft };
  }

  public approveAndPublishDraft(draftId: string) {
    return this.approvePublishDraft(draftId);
  }

  public async rollbackDraft(draftId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ job: { id: string } }>(`/organizations/${organizationId}/drafts/${draftId}/rollback`, {})).data;
    await this.waitForJob(result.job.id);
    const draft = (await this.getDrafts()).drafts.find((item) => item.id === draftId);
    if (!draft) throw new Error('回滚完成，但未找到对应文章记录');
    return { draft };
  }

  // Automated Tasks
  public async getTasks() {
    const { organizationId } = await this.resolveWorkspace();
    const [tasks, sites] = await Promise.all([productionApi.get<ProductionTask[]>(`/organizations/${organizationId}/automation-tasks`), this.getSites()]);
    return { tasks: tasks.data.filter((task) => task.status !== 'DISABLED').map((task) => toLegacyTask(task, sites.sites)) };
  }

  public async createTask(data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    if (!data.siteId || data.siteId === 'all') throw new Error('请选择一个已通过自动发布门禁的站点');
    const intervalHours = data.scheduleType === 'INTERVAL' ? Number.parseInt(data.scheduleTime || '4', 10) : undefined;
    const minutes = intervalHours == null ? undefined : Math.min(43_200, Math.max(60, intervalHours * 60));
    const nextRunAt = new Date();
    if ((data.scheduleType === 'DAILY' || data.scheduleType === 'WEEKLY') && /^\d{2}:\d{2}$/.test(data.scheduleTime || '')) {
      const [hour, minute] = (data.scheduleTime || '09:00').split(':').map(Number);
      nextRunAt.setHours(hour, minute, 0, 0);
      if (data.scheduleType === 'WEEKLY') nextRunAt.setDate(nextRunAt.getDate() + 7);
      else if (nextRunAt <= new Date()) nextRunAt.setDate(nextRunAt.getDate() + 1);
    } else {
      nextRunAt.setMinutes(nextRunAt.getMinutes() + (minutes || 60));
    }
    const sourceValue = data.targetKeywordTopic?.trim();
    if (!sourceValue) throw new Error('请提供关键词、二创内容链接或竞品站点');
    const calendarSchedule = data.scheduleType === 'INTERVAL' ? {} : {
      time: data.scheduleTime || '09:00',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    };
    const created = (await productionApi.post<{ task: ProductionTask }>(`/organizations/${organizationId}/automation-tasks`, { siteId: data.siteId, name: data.taskName || '自动内容任务', scheduleType: data.scheduleType || 'DAILY', scheduleConfig: { sourceType: data.sourceType || 'KEYWORD', sourceValue, ...(minutes ? { minutes } : {}), ...calendarSchedule }, nextRunAt: nextRunAt.toISOString(), enabled: data.status !== 'PAUSED' })).data.task;
    const sites = await this.getSites();
    return { task: toLegacyTask(created, sites.sites) };
  }

  public async updateTask(taskId: string, data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    const updated = (await productionApi.put<{ task: ProductionTask }>(`/organizations/${organizationId}/automation-tasks/${taskId}`, { status: data.status || 'PAUSED' })).data.task;
    const sites = await this.getSites();
    return { task: toLegacyTask(updated, sites.sites) };
  }

  public async deleteTask(taskId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.delete(`/organizations/${organizationId}/automation-tasks/${taskId}`);
    return { success: true, deletedId: taskId };
  }

  public async runTaskNow(taskId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ task: ProductionTask; queued: boolean }>(`/organizations/${organizationId}/automation-tasks/${taskId}/run`, {})).data;
    const sites = await this.getSites();
    return { success: result.queued, message: '任务已进入正式队列', task: toLegacyTask(result.task, sites.sites) };
  }

  // Knowledge Base
  public async getKnowledgeBase(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const sources = (await productionApi.get<ProductionKnowledgeSource[]>(`/organizations/${organizationId}/knowledge-sources?siteId=${siteId}`)).data;
    return { knowledgeSources: sources.map((source) => ({ id: source.id, siteId: source.siteId || siteId, title: source.title, type: source.type === 'ORIGINAL_RESEARCH' ? 'ORIGINAL_RESEARCH' as const : source.type === 'ALLOWLISTED_URL' ? 'WHITELISTED_DOMAIN' as const : 'CLIENT_KB' as const, contentSnippet: source.summary || '已安全保存', addedAt: source.createdAt })) };
  }

  public async addKnowledgeSource(siteId: string, data: { title: string; type?: string; contentSnippet: string; urlOrFilename?: string }) {
    const { organizationId } = await this.resolveWorkspace();
    const payload = data.type === 'WHITELISTED_DOMAIN'
      ? { type: 'ALLOWLISTED_URL', siteId, title: data.title, sourceUrl: data.urlOrFilename }
      : { type: data.type === 'ORIGINAL_RESEARCH' ? 'ORIGINAL_RESEARCH' : 'TEXT', siteId, title: data.title, content: data.contentSnippet };
    const source = (await productionApi.post<{ source: ProductionKnowledgeSource }>(`/organizations/${organizationId}/knowledge-sources`, payload)).data.source;
    return { knowledgeSource: { id: source.id, siteId: source.siteId || siteId, title: source.title, type: source.type === 'ORIGINAL_RESEARCH' ? 'ORIGINAL_RESEARCH' as const : source.type === 'ALLOWLISTED_URL' ? 'WHITELISTED_DOMAIN' as const : 'CLIENT_KB' as const, contentSnippet: source.summary || data.contentSnippet.slice(0, 160), urlOrFilename: data.urlOrFilename, addedAt: source.createdAt } };
  }

  // Metrics
  public async getGrowthMetrics(_siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const [metrics, tasks] = await Promise.all([productionApi.get<{ publishedDrafts: number }>(`/organizations/${organizationId}/metrics`), this.getTasks()]);
    return { metrics: { monthlyOrganicVisits: 0, monthlyVisitsGrowthPct: 0, top10KeywordsCount: 0, newTop10KeywordsThisMonth: 0, newlyIndexedPagesCount: metrics.data.publishedDrafts, activeAutopilotTasksCount: tasks.tasks.filter((task) => task.status === 'ACTIVE').length, pausedTasksCount: tasks.tasks.filter((task) => task.status === 'PAUSED').length } satisfies GrowthMetrics };
  }

}

export const createApiService = (tenantId?: string) => new ApiService(tenantId);
