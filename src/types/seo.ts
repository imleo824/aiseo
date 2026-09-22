export type Language = 'zh-CN' | 'en-US';

export type NavItem =
  | 'DASHBOARD'
  | 'AUTOPILOT_TASKS'
  | 'SITE_MANAGEMENT'
  | 'AUDIT_LEDGER'
  | 'CREDIT_LEDGER'
  | 'ACCOUNT_DATA'
  | 'PRICING_CONFIG'
  | 'SYSTEM_SERVICES_CONFIG'
  | 'TENANT_MANAGEMENT'
  | 'SYSTEM_PAYMENT_MANAGEMENT'
  | 'SYSTEM_BILLING_MANAGEMENT';

type UsdtNetwork = 'TRC20';

export interface ActionPricingItem {
  action: CreditActionType | string;
  name: string;
  credits: string;
  desc: string;
  enabled?: boolean;
}

export interface UsdtPackage {
  id: string;
  name: string;
  usdtAmount: string;
  credits: string;
}

export interface CustomPaymentPricing {
  active: boolean;
  minUsdt: string;
  maxUsdt: string;
  creditsPerUsdt: string;
}

export type CreditTransactionType = 'RECHARGE' | 'CONSUME' | 'ADJUSTMENT';

type CreditActionType =
  | 'USDT_TOPUP'
  | 'GROWTH_RUN'
  | 'ADMIN_ADJUSTMENT';

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: CreditTransactionType;
  action: CreditActionType;
  amount: string; // 精确十进制字符串；正数为充值/增加，负数为消耗
  balance?: string; // 精确十进制字符串；历史来源未记录时不伪造
  description: string;
  createdAt: string;
  txHash?: string;
  usdtAmount?: string;
  requestedCredits?: string;
  network?: UsdtNetwork;
  status?: 'CONFIRMED' | 'PENDING' | 'REJECTED';
  confirmedAt?: string;
  confirmedBy?: string;
  metadata?: {
    siteId?: string;
    siteName?: string;
    domain?: string;
    draftId?: string;
    keyword?: string;
    taskId?: string;
  };
}

type AccountRole = 'ADMIN' | 'TENANT';

export interface TenantAccount {
  id: string;
  username: string;
  email: string;
  companyName?: string;
  credits: string;
  totalRechargedUsdt: string;
  totalConsumedCredits: string;
  role: AccountRole;
  createdAt: string;
}

interface QualityGateResult {
  passed: boolean;
  overallScore: number;
  issues: string[];
  passedChecks: string[];
  checks?: Array<{ name: string; passed: boolean; detail?: string }>;
  generatedAt?: string;
  version?: string;
}

/**
 * A customer-visible state for one stage in the automated publishing pipeline.
 * `SKIPPED` is an intentional, explicitly reported outcome (for example, a
 * missing indexing credential); it must never be displayed as a completion.
 */
export type PipelineStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'FAILED';

export type PipelineStepStates = Record<number, PipelineStepStatus>;

export const AUTOMATION_PIPELINE_STAGES = [
  { number: 1, code: 'UNDERSTAND', title: '了解网站' },
  { number: 2, code: 'DISCOVER', title: '发现机会' },
  { number: 3, code: 'DECIDE', title: '选择动作' },
  { number: 4, code: 'EXECUTE', title: '执行与发布' },
  { number: 5, code: 'LEARN', title: '观察与学习' }
] as const;

export const AUTOMATION_PIPELINE_STAGE_COUNT = AUTOMATION_PIPELINE_STAGES.length;

export interface ArticleDraft {
  id: string;
  opportunityId: string;
  siteId: string;
  title: string;
  language: Language | 'und';
  category: string;
  contentHtml: string;
  summary: string;
  wordCount?: number;
  sourcesUsed: string[];
  qualityGate?: QualityGateResult;
  status: 'DRAFT' | 'QUALITY_PASSED' | 'QUALITY_FAILED' | 'PENDING_APPROVAL' | 'PUBLISHING' | 'PUBLISH_FAILED' | 'REJECTED' | 'PUBLISHED' | 'ROLLING_BACK' | 'ROLLED_BACK';
  publishedUrl?: string;
  publishedAt?: string;
  wpPostId?: number;
  createdAt: string;
}

export interface AutomatedTask {
  id: string;
  siteId: string;
  siteName: string;
  taskName: string;
  scheduleType: 'DAILY' | 'INTERVAL' | 'WEEKLY';
  scheduleTime: string;
  targetKeywordTopic: string;
  sourceType?: 'KEYWORD' | 'REFERENCE_URL' | 'COMPETITOR_SITE';
  inputs?: Array<{ type: 'KEYWORD' | 'REFERENCE_URL' | 'COMPETITOR_SITE'; value: string }>;
  articleCountPerRun: number;
  totalArticles?: number; // 累计文章
  status: 'ACTIVE' | 'PAUSED';
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}

export type SiteType = 'WORDPRESS';

export interface WordPressSite {
  id: string;
  name: string;
  domain: string;
  niche: string;
  siteType?: SiteType;
  siteLanguage: Language;
  connectorStatus: 'CONNECTED' | 'CHECKING' | 'DISCONNECTED' | 'ERROR';
  wordpressCompatibilityMode?: 'RECHECK_REQUIRED' | 'FULL_AUTO' | 'SAFE_AUTO' | 'ANALYSIS_ONLY' | 'BLOCKED';
  wordpressCompatibilityCheckedAt?: string;
  gscConnected: boolean;
  gscPropertyId?: string;
  gscStatus?: string;
  gscLastSyncedAt?: string;
  gscLastErrorMessage?: string;
  createdAt: string;
}
