import { 
  WordPressSite, 
  SiteType,
  Opportunity, 
  ArticleDraft, 
  AuditLogItem, 
  BaiduSubmissionLog, 
  AutomatedTask, 
  GrowthMetrics,
  Language,
  KnowledgeSource,
  CompetitorAttackAnalysis,
  UsageLedgerItem,
  TenantAccount,
  CreditTransaction,
  UsdtPackage,
  UsdtNetwork
} from "../types/seo";

export class ApiService {
  private tenantId: string;
  private authToken: string | null = null;

  constructor(tenantId: string = 'tenant-a') {
    this.tenantId = tenantId;
    this.authToken = localStorage.getItem('autopilot_auth_token');
  }

  public setTenantId(tenantId: string) {
    this.tenantId = tenantId;
  }

  public setAuthToken(token: string | null) {
    this.authToken = token;
    if (token) {
      localStorage.setItem('autopilot_auth_token', token);
    } else {
      localStorage.removeItem('autopilot_auth_token');
    }
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }
    headers.set('X-Tenant-Id', this.tenantId);
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    try {
      const response = await fetch(path, { ...options, headers });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const errorMsg = data?.error?.message || data?.error || data?.message || `API Error: ${response.status} ${response.statusText}`;
        const error = new Error(errorMsg);
        (error as any).status = response.status;
        (error as any).code = data?.error?.code;
        (error as any).details = data?.error?.details;
        throw error;
      }

      return data as T;
    } catch (err: any) {
      console.error(`[ApiService] Request to ${path} failed:`, err);
      throw err;
    }
  }

  // Auth & Tenant
  public login(usernameOrEmail: string, password?: string) {
    return this.request<{ success: boolean; token: string; tenantId: string; account: TenantAccount }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usernameOrEmail, password })
    });
  }

  public register(data: { username: string; email: string; password?: string; companyName?: string }) {
    return this.request<{ success: boolean; token: string; tenantId: string; account: TenantAccount }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public getMe() {
    return this.request<{ success: boolean; tenantId: string; account: TenantAccount }>('/api/auth/me');
  }

  public listTenants() {
    return this.request<{ success: boolean; tenants: TenantAccount[] }>('/api/auth/tenants');
  }

  // Credit & USDT Payment
  public getCreditConfig() {
    return this.request<{ 
      success: boolean; 
      rate: string; 
      trc20Address: string;
      packages: UsdtPackage[]; 
      wallets: Record<string, { network: string; address: string; qrCodePlaceholder: string }>; 
      actionPricing: Array<{ action: string; name?: string; credits: number; desc: string; enabled?: boolean }> 
    }>('/api/credits/config');
  }

  public updatePricingConfig(data: {
    rate?: string;
    trc20Address?: string;
    actionPricing?: Array<{ action: string; name: string; credits: number; desc: string; enabled?: boolean }>;
    packages?: UsdtPackage[];
  }) {
    return this.request<{ success: boolean; message: string; config: any }>('/api/credits/config', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  public resetPricingConfig() {
    return this.request<{ success: boolean; message: string; config: any }>('/api/credits/config/reset', {
      method: 'POST'
    });
  }

  public getCreditBalance() {
    return this.request<{ success: boolean; credits: number; totalRechargedUsdt: number; totalConsumedCredits: number; account: TenantAccount }>('/api/credits/balance');
  }

  public getCreditTransactions() {
    return this.request<{ success: boolean; transactions: CreditTransaction[] }>('/api/credits/transactions');
  }

  public rechargeUsdt(data: { usdtAmount: number; txHash?: string; network?: UsdtNetwork; packageId?: string }) {
    return this.request<{ success: boolean; message: string; credits: number; transaction: CreditTransaction }>('/api/credits/recharge', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Sites
  public getSites() {
    return this.request<{ sites: WordPressSite[] }>('/api/sites');
  }

  public getSiteById(siteId: string) {
    return this.request<{ site: WordPressSite }>(`/api/sites/${siteId}`);
  }

  public testSiteConnection(siteId: string) {
    return this.request<{ result: any; site: WordPressSite }>(`/api/sites/${siteId}/test-connection`, {
      method: 'POST'
    });
  }

  public createSite(data: { 
    name: string; 
    domain: string; 
    niche: string; 
    siteType?: SiteType;
    siteLanguage: Language | string;
    wpUsername?: string;
    wpAppPassword?: string;
    wpRestEndpoint?: string;
    baiduToken?: string;
    indexNowKey?: string;
    monthlyBudgetLimit?: number;
    weeklyPublishCap?: number;
  }) {
    return this.request<{ site: WordPressSite }>('/api/sites', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public updateSite(siteId: string, updated: Partial<WordPressSite>) {
    return this.request<{ site: WordPressSite }>(`/api/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify(updated)
    });
  }

  public deleteSite(siteId: string) {
    return this.request<{ success: boolean; deletedId: string }>(`/api/sites/${siteId}`, {
      method: 'DELETE'
    });
  }

  public toggleAutopilot(siteId: string) {
    return this.request<{ site: WordPressSite }>(`/api/sites/${siteId}/toggle-autopilot`, {
      method: 'POST'
    });
  }

  // Opportunities
  public getOpportunities(siteId: string) {
    return this.request<{ opportunities: Opportunity[] }>(`/api/sites/${siteId}/opportunities`);
  }

  public scanOpportunities(siteId: string, keyword?: string) {
    return this.request<{ opportunity: Opportunity }>(`/api/sites/${siteId}/scan-opportunities`, {
      method: 'POST',
      body: JSON.stringify({ keyword })
    });
  }

  public analyzeCompetitorAttack(siteId: string, competitor: string) {
    return this.request<{ analysis: CompetitorAttackAnalysis }>(`/api/sites/${siteId}/competitor-attack`, {
      method: 'POST',
      body: JSON.stringify({ competitor })
    });
  }

  public generateBrief(oppId: string) {
    return this.request<{ brief: any; opportunity: Opportunity }>(`/api/opportunities/${oppId}/generate-brief`, {
      method: 'POST'
    });
  }

  public generateArticle(oppId: string) {
    return this.request<{ draft: ArticleDraft; opportunity: Opportunity }>(`/api/opportunities/${oppId}/generate-article`, {
      method: 'POST'
    });
  }

  public generateDraft(oppId: string) {
    return this.generateArticle(oppId);
  }

  // Drafts
  public getDrafts() {
    return this.request<{ drafts: ArticleDraft[] }>('/api/drafts');
  }

  public approvePublishDraft(draftId: string) {
    return this.request<{ draft: ArticleDraft; site?: WordPressSite }>(`/api/drafts/${draftId}/approve-publish`, {
      method: 'POST'
    });
  }

  public approveAndPublishDraft(draftId: string) {
    return this.approvePublishDraft(draftId);
  }

  public rollbackDraft(draftId: string) {
    return this.request<{ draft: ArticleDraft }>(`/api/drafts/${draftId}/rollback`, {
      method: 'POST'
    });
  }

  // Automated Tasks
  public getTasks() {
    return this.request<{ tasks: AutomatedTask[] }>('/api/tasks');
  }

  public createTask(data: Partial<AutomatedTask>) {
    return this.request<{ task: AutomatedTask }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public updateTask(taskId: string, data: Partial<AutomatedTask>) {
    return this.request<{ task: AutomatedTask }>(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  public deleteTask(taskId: string) {
    return this.request<{ success: boolean; deletedId: string }>(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });
  }

  public runTaskNow(taskId: string) {
    return this.request<{ success: boolean; task: AutomatedTask; generatedDraft?: ArticleDraft }>(`/api/tasks/${taskId}/run`, {
      method: 'POST'
    });
  }

  // Knowledge Base
  public getKnowledgeBase(siteId: string) {
    return this.request<{ knowledgeSources: KnowledgeSource[] }>(`/api/sites/${siteId}/knowledge-base`);
  }

  public addKnowledgeSource(siteId: string, data: { title: string; type?: string; contentSnippet: string; urlOrFilename?: string }) {
    return this.request<{ knowledgeSource: KnowledgeSource }>(`/api/sites/${siteId}/knowledge-base`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Logs & Metrics
  public getAuditLogs(siteId: string) {
    return this.request<{ auditLogs: AuditLogItem[] }>(`/api/sites/${siteId}/audit-logs`);
  }

  public getUsageLedger() {
    return this.request<{ usageLedger: UsageLedgerItem[] }>('/api/usage-ledger');
  }

  public getBaiduLogs() {
    return this.request<{ baiduLogs: BaiduSubmissionLog[] }>('/api/baidu-logs');
  }

  public getGrowthMetrics(siteId: string) {
    return this.request<{ metrics: GrowthMetrics }>(`/api/sites/${siteId}/growth-metrics`);
  }

  // Health
  public checkHealth() {
    return this.request<any>('/api/health');
  }
}

export const createApiService = (tenantId: string) => new ApiService(tenantId);
