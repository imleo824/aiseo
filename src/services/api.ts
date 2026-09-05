import {
  WordPressSite,
  SiteType,
  ArticleDraft,
  AutomatedTask,
  Language,
  TenantAccount,
  CreditTransaction,
  UsdtPackage,
} from "../types/seo";
import { api as productionApi } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Draft, GrowthProgram, GrowthRun, JobRun, Ledger, Me, Site as ProductionSite } from '../types/api';

type ProductionTask = {
  id: string; siteId: string; inputType: 'KEYWORD' | 'REFERENCE_URL' | 'COMPETITOR_SITE'; inputValue: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'BLOCKED'; deliveredRunCount: number;
  lastRunAt?: string; nextRunAt?: string; createdAt: string;
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
  taskName: `持续增长 · ${task.inputValue.slice(0, 30)}`,
  scheduleType: 'WEEKLY',
  scheduleTime: '系统自适应',
  targetKeywordTopic: task.inputValue,
  sourceType: task.inputType,
  articleCountPerRun: 1,
  totalArticles: task.deliveredRunCount,
  status: task.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
  lastRunAt: task.lastRunAt,
  nextRunAt: task.nextRunAt || task.createdAt,
  createdAt: task.createdAt
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

  public async getPublishingConfirmationPolicy() {
    return (await productionApi.get<{ requireManualConfirmation: boolean }>('/admin/publishing-confirmation-policy')).data;
  }

  public async updatePublishingConfirmationPolicy(requireManualConfirmation: boolean) {
    return (await productionApi.put<{ requireManualConfirmation: boolean }>('/admin/publishing-confirmation-policy', { requireManualConfirmation })).data;
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
    return { site: toLegacySite(created) };
  }

  public async updateSite(siteId: string, updated: Partial<WordPressSite>) {
    const { organizationId } = await this.resolveWorkspace();
    const payload = { name: updated.name, domain: updated.domain, language: updated.siteLanguage }.valueOf();
    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    await productionApi.put(`/organizations/${organizationId}/sites/${siteId}`, cleanPayload);
    const site = (await productionApi.get<ProductionSite[]>(`/organizations/${organizationId}/sites`)).data.find((item) => item.id === siteId);
    if (!site) throw new Error('站点更新后无法读取');
    return { site: toLegacySite(site) };
  }

  public async deleteSite(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.delete(`/organizations/${organizationId}/sites/${siteId}`);
    return { success: true, deletedId: siteId };
  }

  public async authorizeWordPress(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ authorizationUrl: string; expiresInSeconds: number }>(`/organizations/${organizationId}/sites/${siteId}/wordpress/authorize`, {})).data;
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

  public async listGrowthPrograms(siteId: string): Promise<GrowthProgram[]> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<GrowthProgram[]>(`/organizations/${organizationId}/sites/${siteId}/growth-programs`)).data;
  }

  public async getGrowthRun(runId: string): Promise<GrowthRun> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<GrowthRun>(`/organizations/${organizationId}/growth-runs/${runId}`)).data;
  }

  public async createGrowthProgram(
    siteId: string,
    mode: 'ONCE' | 'CONTINUOUS',
    input: { type: 'KEYWORD' | 'REFERENCE_URL' | 'COMPETITOR_SITE'; value: string },
    onProgress?: (run: GrowthRun) => void
  ) {
    const { organizationId } = await this.resolveWorkspace();
    const created = (await productionApi.post<{ program: GrowthProgram; run: GrowthRun; job: JobRun }>(`/organizations/${organizationId}/sites/${siteId}/growth-programs`, { mode, input })).data;
    let run = created.run;
    onProgress?.(run);
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      run = await this.getGrowthRun(run.id);
      onProgress?.(run);
      if (['NEEDS_REVIEW', 'DELIVERED', 'BLOCKED', 'FAILED', 'CANCELLED'].includes(run.status)) break;
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
    if (run.status === 'FAILED' || (run.status === 'BLOCKED' && run.errorCode !== 'NO_QUALIFIED_OPPORTUNITY')) {
      throw new Error(run.errorMessage || '增长执行被安全门禁阻止');
    }
    if (!['NEEDS_REVIEW', 'DELIVERED', 'BLOCKED'].includes(run.status)) {
      throw new Error('增长执行仍在后台运行，请稍后查看真实进度');
    }
    const draft = run.draft || (run.draftId ? (await productionApi.get<Draft[]>(`/organizations/${organizationId}/drafts`)).data.find((item) => item.id === run.draftId) : undefined);
    return { program: created.program, run, draft: draft ? toLegacyDraft(draft) : undefined };
  }

  public async changeGrowthProgram(programId: string, status: 'ACTIVE' | 'PAUSED') {
    const { organizationId } = await this.resolveWorkspace();
    const action = status === 'ACTIVE' ? 'resume' : 'pause';
    return (await productionApi.post<{ program: GrowthProgram }>(`/organizations/${organizationId}/growth-programs/${programId}/${action}`, {})).data.program;
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
    const sites = await this.getSites();
    const programs = (await Promise.all(sites.sites.map((site) => this.listGrowthPrograms(site.id)))).flat().filter((program) => program.mode === 'CONTINUOUS');
    return { tasks: programs.map((program) => toLegacyTask(program as ProductionTask, sites.sites)) };
  }

  public async createTask(data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    if (!data.siteId || data.siteId === 'all') throw new Error('请选择一个已连接的 WordPress 站点');
    const sourceValue = data.targetKeywordTopic?.trim();
    if (!sourceValue) throw new Error('请提供关键词、参考文章链接或竞品站点');
    const inputType = data.sourceType || 'KEYWORD';
    const created = (await productionApi.post<{ program: GrowthProgram }>(`/organizations/${organizationId}/sites/${data.siteId}/growth-programs`, { mode: 'CONTINUOUS', input: { type: inputType, value: sourceValue } })).data.program;
    const sites = await this.getSites();
    return { task: toLegacyTask(created as ProductionTask, sites.sites) };
  }

  public async updateTask(taskId: string, data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    const updated = await this.changeGrowthProgram(taskId, data.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED');
    const sites = await this.getSites();
    return { task: toLegacyTask(updated as ProductionTask, sites.sites) };
  }

  public async runTaskNow(taskId: string) {
    const result = await this.changeGrowthProgram(taskId, 'ACTIVE');
    const sites = await this.getSites();
    return { success: true, message: '已恢复，数据库调度器将在下一轮创建真实执行', task: toLegacyTask(result as ProductionTask, sites.sites) };
  }

}

export const createApiService = (tenantId?: string) => new ApiService(tenantId);
