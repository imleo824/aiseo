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
import { getSupabaseBrowserClient } from '../lib/supabase';
import { decimalToMicros, microsToDecimal } from '../lib/fixedDecimal';

const supabase = getSupabaseBrowserClient();
import type { Draft, GrowthCandidate, GrowthInput, GrowthProgram, GrowthRun, GrowthStatus, JobRun, Ledger, Me, Site as ProductionSite, SiteSnapshotSummary } from '../types/api';

type ProductionTask = {
  id: string; siteId: string; inputs: GrowthInput[];
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'BLOCKED'; deliveredRunCount: number;
  lastRunAt?: string; nextRunAt?: string; createdAt: string;
};

const positiveMicros = (value: string, label: string): string => {
  const micros = decimalToMicros(value);
  if (BigInt(micros) <= 0n) throw new Error(`${label}必须大于 0`);
  return micros;
};

const toWorkspaceSite = (site: ProductionSite): WordPressSite => {
  return {
    id: site.id,
    name: site.name,
    domain: site.domain,
    niche: site.niche || '待系统识别',
    siteType: 'WORDPRESS',
    siteLanguage: site.language,
    connectorStatus: site.wordpressStatus === 'CONNECTED' ? 'CONNECTED' : site.wordpressStatus === 'VERIFYING' ? 'CHECKING' : site.wordpressStatus === 'FAILED' ? 'ERROR' : 'DISCONNECTED',
    wordpressCompatibilityMode: site.wordpressCompatibilityMode,
    wordpressCompatibilityCheckedAt: site.wordpressCompatibilityCheckedAt,
    gscConnected: site.integrations.some((item) => item.provider === 'GSC' && item.status === 'CONNECTED'),
    gscPropertyId: site.integrations.find((item) => item.provider === 'GSC')?.propertyId,
    gscStatus: site.integrations.find((item) => item.provider === 'GSC')?.status,
    gscLastSyncedAt: site.integrations.find((item) => item.provider === 'GSC')?.lastSyncedAt,
    gscLastErrorMessage: site.integrations.find((item) => item.provider === 'GSC')?.lastErrorMessage,
    createdAt: site.createdAt
  };
};

const qualityGate = (report: Draft['qualityReport']): ArticleDraft['qualityGate'] => {
  if (typeof report?.passed !== 'boolean' || typeof report?.score !== 'number') return undefined;
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return {
    passed: report.passed,
    overallScore: report.score,
    issues: report.issues || checks.filter(({ passed }) => !passed).map(({ detail, name }) => detail || name),
    passedChecks: report.passedChecks || checks.filter(({ passed }) => passed).map(({ name }) => name),
    checks,
    generatedAt: report.generatedAt,
    version: report.version
  };
};

export const toWorkspaceDraft = (draft: Draft): ArticleDraft => ({
  id: draft.id,
  opportunityId: draft.opportunityId || '',
  siteId: draft.siteId,
  title: draft.title,
  language: 'und',
  category: '增长动作',
  contentHtml: draft.html,
  summary: draft.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
  sourcesUsed: draft.knowledgeSourceIds || [],
  qualityGate: qualityGate(draft.qualityReport),
  status: draft.status === 'PUBLISHED' ? 'PUBLISHED'
    : draft.status === 'ROLLED_BACK' ? 'ROLLED_BACK'
      : draft.status === 'ROLLING_BACK' ? 'ROLLING_BACK'
        : draft.status === 'PUBLISHING' ? 'PUBLISHING'
          : draft.status === 'PUBLISH_FAILED' ? 'PUBLISH_FAILED'
            : draft.status === 'REJECTED' ? 'REJECTED'
              : draft.status === 'PENDING_REVIEW' ? 'PENDING_APPROVAL'
                : draft.status === 'QUALITY_FAILED' ? 'QUALITY_FAILED'
                  : draft.qualityReport?.passed ? 'QUALITY_PASSED' : 'DRAFT',
  publishedUrl: draft.publishedUrl,
  publishedAt: (draft.publishAttempts || [])
    .filter(({ status, finishedAt }) => status === 'SUCCEEDED' && finishedAt)
    .sort((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)))[0]?.finishedAt,
  createdAt: draft.createdAt
});

const toWorkspaceTask = (task: ProductionTask, sites: WordPressSite[]): AutomatedTask => {
  const primary = task.inputs[0];
  const label = task.inputs.map(({ value }) => value).join('、');
  return ({
  id: task.id,
  siteId: task.siteId,
  siteName: sites.find((site) => site.id === task.siteId)?.name || '未知站点',
  taskName: `持续增长 · ${label.slice(0, 30)}`,
  scheduleType: 'WEEKLY',
  scheduleTime: '系统自适应',
  targetKeywordTopic: label,
  sourceType: primary?.type,
  inputs: task.inputs.map(({ type, value }) => ({ type, value })),
  articleCountPerRun: 1,
  totalArticles: task.deliveredRunCount,
  status: task.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
  lastRunAt: task.lastRunAt,
  nextRunAt: task.nextRunAt || task.createdAt,
  createdAt: task.createdAt
  });
};

export class ApiService {
  private organizationId = '';
  private me?: Me;

  constructor(tenantId?: string) { this.organizationId = tenantId || ''; }

  private async listAll<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const separator = path.includes('?') ? '&' : '?';
      const response = await productionApi.get<T[]>(`${path}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      rows.push(...response.data);
      if (rows.length > 10_000) throw new Error('当前页面一次最多加载 10,000 条记录，请缩小查询范围');
      cursor = response.meta?.nextCursor;
      if (cursor && seenCursors.has(cursor)) throw new Error('服务器返回了重复分页游标，请稍后重试');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return rows;
  }

  private async readLedger(): Promise<Ledger> {
    const { organizationId } = await this.resolveWorkspace();
    const entries: Ledger['entries'] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let balances: Pick<Ledger, 'balanceMicros' | 'heldMicros' | 'availableMicros'> | undefined;
    do {
      const response = await productionApi.get<Ledger>(`/organizations/${organizationId}/ledger?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      balances ||= {
        balanceMicros: response.data.balanceMicros,
        heldMicros: response.data.heldMicros,
        availableMicros: response.data.availableMicros
      };
      entries.push(...response.data.entries);
      if (entries.length > 10_000) throw new Error('当前页面一次最多加载 10,000 条账本记录，请缩小查询范围');
      cursor = response.meta?.nextCursor;
      if (cursor && seenCursors.has(cursor)) throw new Error('服务器返回了重复账本游标，请稍后重试');
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    if (!balances) throw new Error('服务器未返回账本余额');
    return { ...balances, entries };
  }

  private async resolveWorkspace(): Promise<{ me: Me; organizationId: string }> {
    if (!this.me || !this.organizationId) {
      this.me = (await productionApi.get<Me>('/me')).data;
      this.organizationId = this.me.organizations[0]?.id || '';
    }
    if (!this.organizationId) throw new Error('个人工作区尚未完成初始化');
    return { me: this.me, organizationId: this.organizationId };
  }

  public setTenantId(tenantId: string) {
    this.organizationId = tenantId;
  }

  // Auth & Tenant
  public async getMe() {
    const { me, organizationId } = await this.resolveWorkspace();
    const organization = me.organizations.find((item) => item.id === organizationId) || me.organizations[0];
    if (!organization) throw new Error('个人工作区尚未完成初始化');
    return {
      success: true,
      tenantId: organization.id,
      account: {
        id: me.profile.id,
        username: me.profile.displayName || me.profile.email.split('@')[0],
        email: me.profile.email,
        companyName: organization.name,
        credits: microsToDecimal(organization.creditBalanceMicros),
        totalRechargedUsdt: microsToDecimal(organization.totalRechargedMicros),
        totalConsumedCredits: microsToDecimal(organization.totalConsumedMicros),
        role: me.profile.platformRole === 'PLATFORM_ADMIN' ? 'ADMIN' : 'TENANT',
        createdAt: me.profile.createdAt
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
    const organizations = await this.listAll<{ id: string; name: string; creditBalanceMicros: string; totalRechargedMicros: string; totalConsumedMicros: string; createdAt: string; owner?: { email: string; displayName?: string } | null }>('/admin/organizations');
    return { success: true, tenants: organizations.map((organization) => ({ id: organization.id, username: organization.owner?.displayName || organization.name, email: organization.owner?.email || '未关联所有者邮箱', companyName: organization.name, credits: microsToDecimal(organization.creditBalanceMicros), totalRechargedUsdt: microsToDecimal(organization.totalRechargedMicros), totalConsumedCredits: microsToDecimal(organization.totalConsumedMicros), role: 'TENANT' as const, createdAt: organization.createdAt })) };
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
      packages: pricing.packages.filter((item) => item.active).map((item) => ({ id: item.id, name: item.name, usdtAmount: microsToDecimal(item.baseAmountMicros), credits: microsToDecimal(item.creditMicros) })),
      actionPricing: pricing.actions.map((item) => ({ action: item.action, name: item.name, credits: microsToDecimal(item.creditMicros), desc: item.description, enabled: item.active })),
      paymentAvailable: pricing.packages.some((item) => item.active),
      paymentNotice: '创建充值订单后显示唯一 TRC20 应付金额与收款地址。'
    };
  }

  public async updatePricingConfig(data: {
    rate?: string;
    trc20Address?: string;
    actionPricing?: Array<{ action: string; name: string; credits: string; desc: string; enabled?: boolean }>;
    packages?: UsdtPackage[];
  }) {
    const packages = (data.packages || []).map((item, sortOrder) => {
      if (!/^[1-9]\d*$/.test(item.usdtAmount.trim())) throw new Error('充值套餐基础金额必须是正整数 USDT');
      return { id: item.id, name: item.name, baseAmountMicros: positiveMicros(item.usdtAmount, '充值金额'), creditMicros: positiveMicros(item.credits, '到账积分'), active: true, sortOrder };
    });
    const actions = (data.actionPricing || []).map((item) => ({ action: item.action, name: item.name, description: item.desc, creditMicros: positiveMicros(item.credits, '业务积分单价'), active: item.enabled !== false }));
    await productionApi.put('/admin/pricing', { packages, actions });
    return { success: true, message: '定价已写入正式数据库并记录审计事件', config: data };
  }

  public async getCreditTransactions() {
    const { organizationId } = await this.resolveWorkspace();
    const ledger = await this.readLedger();
    return { success: true, transactions: ledger.entries.map((entry) => {
      const type = entry.type === 'PURCHASE' ? 'RECHARGE' as const
        : entry.type === 'CONSUMPTION' ? 'CONSUME' as const
          : 'ADJUSTMENT' as const;
      const action = entry.type === 'PURCHASE' ? 'USDT_TOPUP' as const
        : entry.type === 'ADJUSTMENT' ? 'ADMIN_ADJUSTMENT' as const
          : 'GROWTH_RUN' as const;
      return { id: entry.id, tenantId: organizationId, type, action, amount: microsToDecimal(entry.amountMicros), balance: microsToDecimal(entry.balanceAfterMicros), description: entry.reason, createdAt: entry.createdAt, txHash: typeof entry.metadata?.txHash === 'string' ? entry.metadata.txHash : undefined, usdtAmount: typeof entry.metadata?.valueMicros === 'string' ? microsToDecimal(entry.metadata.valueMicros) : undefined, network: entry.paymentIntentId ? 'TRC20' as const : undefined, status: 'CONFIRMED' as const, metadata: {} as CreditTransaction['metadata'] };
    }) };
  }

  public async createPaymentIntent(packageId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ paymentIntent: { id: string; packageId: string; network: 'TRC20'; recipientAddress: string; baseAmountUsdt: string; expectedAmountUsdt: string; creditMicros: string; status: string; expiresAt: string } }>(`/organizations/${organizationId}/payment-intents`, { packageId })).data.paymentIntent;
  }

  public async submitPaymentTransaction(paymentIntentId: string, txHash: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ paymentIntent: { id: string; status: string } }>(`/organizations/${organizationId}/payment-intents/${paymentIntentId}/submit-transaction`, { txHash })).data.paymentIntent;
  }

  public async getAllTransactions() {
    const payments = await this.listAll<{ id: string; organizationId: string; expectedAmountMicros: string; creditMicros: string; txHash?: string; status: string; createdAt: string }>('/admin/payments');
    return { success: true, transactions: payments.map((payment) => ({ id: payment.id, tenantId: payment.organizationId, type: 'RECHARGE' as const, action: 'USDT_TOPUP' as const, amount: microsToDecimal(payment.creditMicros), description: 'TRC20 USDT 充值', createdAt: payment.createdAt, txHash: payment.txHash, usdtAmount: microsToDecimal(payment.expectedAmountMicros), network: 'TRC20' as const, status: payment.status === 'CREDITED' ? 'CONFIRMED' as const : payment.status === 'REJECTED' || payment.status === 'EXPIRED' ? 'REJECTED' as const : 'PENDING' as const })) };
  }

  public async getAllUsages() {
    const usages = await this.listAll<{ id: string; organizationId: string; action: string; amountMicros: string; resultId?: string; createdAt: string }>('/admin/usage');
    return { success: true, usages: usages.map((usage) => ({ id: usage.id, tenantId: usage.organizationId, action: usage.action, actionName: usage.action, creditsDeducted: microsToDecimal(usage.amountMicros), createdAt: usage.createdAt, description: usage.resultId ? `交付结果 ${usage.resultId}` : '已结算业务用量' })) } as { success: boolean; usages: Array<{
      id: string;
      tenantId: string;
      siteId?: string;
      taskId?: string;
      action: string;
      actionName: string;
      creditsDeducted: string;
      remainingCredits?: string;
      createdAt: string;
      description?: string;
    }> };
  }

  public async adjustTenantCredits(targetTenantId: string, deltaCredits: string, reason: string) {
    const amountMicros = decimalToMicros(deltaCredits);
    if (BigInt(amountMicros) === 0n) throw new Error('积分调整金额不能为 0');
    const result = (await productionApi.post<{ organization: { creditBalanceMicros: string }; entry: { id: string; createdAt: string } }>(`/admin/organizations/${targetTenantId}/adjustment`, { amountMicros, reason })).data;
    return { success: true, message: '积分调整已追加到账本', balance: microsToDecimal(result.organization.creditBalanceMicros), account: {} as TenantAccount, transaction: { id: result.entry.id } as CreditTransaction };
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
    const sites = await this.listAll<ProductionSite>(`/organizations/${organizationId}/sites`);
    return { sites: sites.map(toWorkspaceSite) };
  }

  public async testSiteConnection(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ connected: boolean; user?: string; capabilities?: unknown }>(`/organizations/${organizationId}/sites/${siteId}/test-connection`, {})).data;
    const site = (await this.getSites()).sites.find((item) => item.id === siteId);
    if (!site) throw new Error('站点连接已测试，但站点记录不存在');
    return { result, site };
  }

  public async createSite(data: {
    name: string;
    domain: string;
    niche?: string;
    siteType?: SiteType;
    siteLanguage: Language;
  }) {
    const { organizationId } = await this.resolveWorkspace();
    if (data.siteType && data.siteType !== 'WORDPRESS') throw new Error('当前正式版本仅支持 WordPress');
    const created = (await productionApi.post<{ site: ProductionSite }>(`/organizations/${organizationId}/sites`, { name: data.name, domain: data.domain, language: data.siteLanguage, niche: data.niche })).data.site;
    return { site: toWorkspaceSite(created) };
  }

  public async updateSite(siteId: string, updated: Partial<WordPressSite>) {
    const { organizationId } = await this.resolveWorkspace();
    const payload = { name: updated.name, domain: updated.domain, language: updated.siteLanguage, niche: updated.niche }.valueOf();
    const cleanPayload = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
    await productionApi.put(`/organizations/${organizationId}/sites/${siteId}`, cleanPayload);
    const site = (await this.getSites()).sites.find((item) => item.id === siteId);
    if (!site) throw new Error('站点更新后无法读取');
    return { site };
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

  public async recheckWordPressCompatibility(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post(`/organizations/${organizationId}/sites/${siteId}/wordpress/recheck`, {})).data;
  }

  public async authorizeGsc(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.post<{ authorizationUrl: string }>(`/organizations/${organizationId}/sites/${siteId}/gsc/authorize`, {})).data;
  }

  public async syncGsc(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    // Search Console final data normally trails real time. Exclude the most
    // recent three days so a manual sync cannot present partial rows as a drop.
    const end = new Date(Date.now() - 3 * 24 * 60 * 60_000);
    const start = new Date(end.getTime() - 27 * 24 * 60 * 60_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    return (await productionApi.post<{ job: { id: string } }>(`/organizations/${organizationId}/sites/${siteId}/gsc/sync`, { startDate: date(start), endDate: date(end) })).data;
  }

  public async disconnectGsc(siteId: string) {
    const { organizationId } = await this.resolveWorkspace();
    await productionApi.delete(`/organizations/${organizationId}/sites/${siteId}/gsc`);
  }

  public async listGrowthPrograms(siteId: string): Promise<GrowthProgram[]> {
    const { organizationId } = await this.resolveWorkspace();
    return this.listAll<GrowthProgram>(`/organizations/${organizationId}/sites/${siteId}/growth-programs`);
  }

  public async getGrowthRun(runId: string): Promise<GrowthRun> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<GrowthRun>(`/organizations/${organizationId}/growth-runs/${runId}`)).data;
  }

  public async getGrowthStatus(siteId: string): Promise<GrowthStatus> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<GrowthStatus>(`/organizations/${organizationId}/sites/${siteId}/growth-status`)).data;
  }

  public async getLatestSiteSnapshot(siteId: string): Promise<SiteSnapshotSummary> {
    const { organizationId } = await this.resolveWorkspace();
    return (await productionApi.get<SiteSnapshotSummary>(`/organizations/${organizationId}/sites/${siteId}/site-snapshots/latest`)).data;
  }

  public async getGrowthCandidates(runId: string): Promise<GrowthCandidate[]> {
    const { organizationId } = await this.resolveWorkspace();
    return this.listAll<GrowthCandidate>(`/organizations/${organizationId}/growth-runs/${runId}/candidates`);
  }

  public async createGrowthProgram(
    siteId: string,
    mode: 'ONCE' | 'CONTINUOUS',
    inputs: GrowthInput[],
    onProgress?: (run: GrowthRun) => void
  ) {
    const { organizationId } = await this.resolveWorkspace();
    const created = (await productionApi.post<{ program: GrowthProgram; run: GrowthRun; job: JobRun }>(`/organizations/${organizationId}/sites/${siteId}/growth-programs`, { mode, inputs })).data;
    onProgress?.(created.run);
    return { program: created.program, run: created.run, draft: created.run.draft ? toWorkspaceDraft(created.run.draft) : undefined };
  }

  public async changeGrowthProgram(programId: string, status: 'ACTIVE' | 'PAUSED') {
    const { organizationId } = await this.resolveWorkspace();
    const action = status === 'ACTIVE' ? 'resume' : 'pause';
    return (await productionApi.post<{ program: GrowthProgram }>(`/organizations/${organizationId}/growth-programs/${programId}/${action}`, {})).data.program;
  }

  // Drafts
  public async getDrafts() {
    const { organizationId } = await this.resolveWorkspace();
    const drafts = await this.listAll<Draft>(`/organizations/${organizationId}/drafts`);
    return { drafts: drafts.map(toWorkspaceDraft) };
  }

  public async approvePublishDraft(draftId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const queued = (await productionApi.post<{ draft: Draft; job: JobRun }>(`/organizations/${organizationId}/drafts/${draftId}/approve`, {})).data;
    return { draft: toWorkspaceDraft(queued.draft), job: queued.job };
  }

  public async rejectDraft(draftId: string, comment: string) {
    const { organizationId } = await this.resolveWorkspace();
    const rejected = (await productionApi.post<{ draft: Draft }>(`/organizations/${organizationId}/drafts/${draftId}/reject`, { comment })).data;
    return { draft: toWorkspaceDraft(rejected.draft) };
  }

  public async retryPublishDraft(draftId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const queued = (await productionApi.post<{ draft: Draft; job: JobRun }>(`/organizations/${organizationId}/drafts/${draftId}/retry-publish`, {})).data;
    return { draft: toWorkspaceDraft(queued.draft), job: queued.job };
  }

  public async rollbackDraft(draftId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const queued = (await productionApi.post<{ draft: Draft; job: JobRun }>(`/organizations/${organizationId}/drafts/${draftId}/rollback`, {})).data;
    return { draft: toWorkspaceDraft(queued.draft), job: queued.job };
  }

  // Automated Tasks
  public async getTasks() {
    const sites = await this.getSites();
    const programs = (await Promise.all(sites.sites.map((site) => this.listGrowthPrograms(site.id)))).flat().filter((program) => program.mode === 'CONTINUOUS');
    return { tasks: programs.map((program) => toWorkspaceTask(program as ProductionTask, sites.sites)) };
  }

  public async createTask(data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    if (!data.siteId || data.siteId === 'all') throw new Error('请选择一个已连接的 WordPress 站点');
    const inputs = (data.inputs || []).map(({ type, value }) => ({ type, value: value.trim() })).filter(({ value }) => Boolean(value));
    const created = (await productionApi.post<{ program: GrowthProgram }>(`/organizations/${organizationId}/sites/${data.siteId}/growth-programs`, { mode: 'CONTINUOUS', inputs })).data.program;
    const sites = await this.getSites();
    return { task: toWorkspaceTask(created as ProductionTask, sites.sites) };
  }

  public async updateTask(taskId: string, data: Partial<AutomatedTask>) {
    const { organizationId } = await this.resolveWorkspace();
    const updated = await this.changeGrowthProgram(taskId, data.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED');
    const sites = await this.getSites();
    return { task: toWorkspaceTask(updated as ProductionTask, sites.sites) };
  }

  public async runTaskNow(taskId: string) {
    const { organizationId } = await this.resolveWorkspace();
    const result = (await productionApi.post<{ program: GrowthProgram; run: GrowthRun }>(`/organizations/${organizationId}/growth-programs/${taskId}/run-now`, {})).data;
    const sites = await this.getSites();
    return { success: true, message: '新机会检查已进入后台队列，可离开页面后继续执行', task: toWorkspaceTask(result.program as ProductionTask, sites.sites), run: result.run };
  }

}

export const createApiService = (tenantId?: string) => new ApiService(tenantId);
