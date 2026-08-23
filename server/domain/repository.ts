import { 
  WordPressSite, 
  Opportunity, 
  ArticleDraft, 
  KnowledgeSource, 
  AuditLogItem, 
  BaiduSubmissionLog, 
  AutomatedTask, 
  TenantAccount,
  CreditTransaction,
  CreditActionType,
  UsdtNetwork
} from '../../src/types/seo';

export type TenantId = string;
export type SiteId = string;
export type OpportunityId = string;
export type DraftId = string;
export type TaskId = string;

export interface TenantData {
  account?: TenantAccount;
  passwordHash?: string;
  sites: WordPressSite[];
  opportunities: Opportunity[];
  drafts: ArticleDraft[];
  knowledgeSources: KnowledgeSource[];
  auditLogs: AuditLogItem[];
  usageLedger: any[];
  baiduLogs: BaiduSubmissionLog[];
  automatedTasks: AutomatedTask[];
  creditTransactions?: CreditTransaction[];
}

export interface PipelineExecutionResult {
  step: 'DISCOVERY' | 'BRIEF' | 'DRAFT' | 'QUALITY_GATE' | 'PUBLISH';
  status: 'SUCCESS' | 'FAILED' | 'PENDING_APPROVAL';
  opportunityId: string;
  draftId?: string;
  publishedUrl?: string;
  gatePassed?: boolean;
  score?: number;
  message?: string;
  error?: string;
  traceId?: string;
}

export interface ITenantRepository {
  getTenantData(tenantId: string): TenantData;
  saveTenantData(tenantId: string, data: TenantData): Promise<void>;
  getAllTenantIds(): string[];
  getAccount(tenantId: string): TenantAccount;
  saveAccount(tenantId: string, account: TenantAccount): Promise<TenantAccount>;
  getCreditTransactions(tenantId: string): CreditTransaction[];
  appendCreditTransaction(tenantId: string, tx: CreditTransaction): Promise<CreditTransaction>;
  consumeCredits(tenantId: string, amount: number, action: CreditActionType, description: string, metadata?: any): Promise<{ success: boolean; balance: number; tx?: CreditTransaction; message?: string }>;
  rechargeUsdt(tenantId: string, usdtAmount: number, credits: number, txHash: string, network: UsdtNetwork): Promise<{ success: boolean; balance: number; tx: CreditTransaction }>;
  findTenantByEmailOrUsername(identifier: string): { tenantId: string; account: TenantAccount; passwordHash?: string } | undefined;
  createTenantAccount(account: TenantAccount, passwordHash: string): Promise<TenantAccount>;
  getSite(tenantId: string, siteId: string): WordPressSite | undefined;
  saveSite(tenantId: string, site: WordPressSite): Promise<WordPressSite>;
  removeSite(tenantId: string, siteId: string): Promise<boolean>;
  getOpportunity(tenantId: string, oppId: string): Opportunity | undefined;
  saveOpportunity(tenantId: string, opp: Opportunity): Promise<Opportunity>;
  getDraft(tenantId: string, draftId: string): ArticleDraft | undefined;
  saveDraft(tenantId: string, draft: ArticleDraft): Promise<ArticleDraft>;
  getTasks(tenantId: string): AutomatedTask[];
  saveTask(tenantId: string, task: AutomatedTask): Promise<AutomatedTask>;
  deleteTask(tenantId: string, taskId: string): Promise<boolean>;
  appendAuditLog(tenantId: string, log: AuditLogItem): Promise<void>;
  appendBaiduLog(tenantId: string, log: BaiduSubmissionLog): Promise<void>;
}
