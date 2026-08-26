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
  UsdtNetwork,
  SystemServicesConfig,
  ServiceConnectionTestResult
} from "../types/seo";

export class ApiService {
  private tenantId: string;

  constructor(tenantId: string = 'tenant-a') {
    this.tenantId = tenantId;
  }

  public setTenantId(tenantId: string) {
    this.tenantId = tenantId;
  }

  public setAuthToken(token: string | null) {
    // Browser sessions are HttpOnly cookies. This method remains as a compatibility no-op.
    void token;
  }

  public getAuthToken(): string | null {
    return null;
  }

  private async request<T>(path: string, options: RequestInit = {}, retries = 2): Promise<T> {
    const retryableMethod = !options.method || ['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase());
    const maxRetries = retryableMethod ? retries : 0;
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          const isTransient = [502, 503, 504].includes(response.status);
          if (isTransient && attempt < maxRetries) {
            attempt++;
            const backoffMs = Math.pow(2, attempt) * 200;
            await new Promise(r => setTimeout(r, backoffMs));
            continue;
          }

          const errorMsg = data?.error?.message || data?.error || data?.message || `API Error: ${response.status} ${response.statusText}`;
          const error = new Error(errorMsg);
          (error as any).status = response.status;
          (error as any).code = data?.error?.code;
          (error as any).details = data?.error?.details;
          throw error;
        }

        return data as T;
      } catch (err: any) {
        const isNetworkErr = !err.status && attempt < maxRetries;
        if (isNetworkErr) {
          attempt++;
          const backoffMs = Math.pow(2, attempt) * 200;
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        console.error(`[ApiService] Request to ${path} failed (attempt ${attempt + 1}):`, err);
        throw err;
      }
    }
    throw new Error(`[ApiService] Max retries reached for ${path}`);
  }

  // Auth & Tenant
  public login(usernameOrEmail: string, password?: string) {
    return this.request<{ success: boolean; tenantId: string; account: TenantAccount }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ usernameOrEmail, password })
    });
  }

  public register(data: { username: string; email: string; password?: string; companyName?: string }) {
    return this.request<{ success: boolean; tenantId: string; account: TenantAccount }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public getMe() {
    return this.request<{ success: boolean; tenantId: string; account: TenantAccount }>('/api/auth/me');
  }

  public logout() {
    return this.request<void>('/api/auth/logout', { method: 'POST' }, 0);
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

  public getSystemServicesConfig() {
    return this.request<{ success: boolean; config: SystemServicesConfig }>('/api/system/services-config');
  }

  public updateSystemServicesConfig(config: Partial<SystemServicesConfig>) {
    return this.request<{ success: boolean; message: string; config: SystemServicesConfig }>('/api/system/services-config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
  }

  public resetSystemServicesConfig() {
    return this.request<{ success: boolean; message: string; config: SystemServicesConfig }>('/api/system/services-config/reset', {
      method: 'POST'
    });
  }

  public testServiceConnection(serviceType: string, customParams?: Record<string, any>) {
    return this.request<ServiceConnectionTestResult>('/api/system/services-config/test-connection', {
      method: 'POST',
      body: JSON.stringify({ serviceType, customParams })
    });
  }

  public getCreditBalance() {
    return this.request<{ success: boolean; credits: number; totalRechargedUsdt: number; totalConsumedCredits: number; account: TenantAccount }>('/api/credits/balance');
  }

  public getCreditTransactions() {
    return this.request<{ success: boolean; transactions: CreditTransaction[] }>('/api/credits/transactions');
  }

  public rechargeUsdt(data: { usdtAmount: number; txHash?: string; network?: UsdtNetwork; packageId?: string }) {
    return this.request<{ success: boolean; message: string; transaction: CreditTransaction }>('/api/credits/recharge', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  public getAllTransactions() {
    return this.request<{ success: boolean; transactions: CreditTransaction[] }>('/api/admin/transactions');
  }

  public getAllUsages() {
    return this.request<{ success: boolean; usages: Array<{
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
    }> }>('/api/admin/usages');
  }

  public adjustTenantCredits(targetTenantId: string, deltaCredits: number, reason: string) {
    return this.request<{ success: boolean; message: string; balance: number; account: TenantAccount; transaction: CreditTransaction }>('/api/admin/tenants/adjust-credits', {
      method: 'POST',
      body: JSON.stringify({ targetTenantId, deltaCredits, reason })
    });
  }

  public confirmPaymentStatus(txId: string, status: 'CONFIRMED' | 'PENDING' | 'REJECTED', targetTenantId?: string) {
    return this.request<{ success: boolean; message: string; transaction: CreditTransaction }>('/api/admin/payments/confirm', {
      method: 'POST',
      body: JSON.stringify({ txId, status, targetTenantId })
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

  public testSiteSearchEngine(siteId: string, engineType: 'BAIDU' | 'GOOGLE', customParams?: {
    baiduToken?: string;
    googleServiceAccountJson?: string;
  }) {
    return this.request<{
      engine: string;
      success: boolean;
      latencyMs?: number;
      message: string;
      details?: any;
      testedAt: string;
    }>(`/api/sites/${siteId}/test-search-engine`, {
      method: 'POST',
      body: JSON.stringify({ engineType, customParams })
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
    googleServiceAccountJson?: string;
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

  public serpScan(data: { seedKeyword: string; location?: string }) {
    return this.request<{ 
      success: boolean; 
      source?: string; 
      quotaStatus?: any; 
      opportunities: any[] 
    }>('/api/keywords/serp-scan', {
      method: 'POST',
      body: JSON.stringify(data)
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

export const createApiService = (tenantId: string = 'tenant-a') => new ApiService(tenantId);
