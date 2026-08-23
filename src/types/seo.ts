export type Language = 'zh-CN' | 'en' | 'en-US';

export type NavItem = 
  | 'DASHBOARD'
  | 'AUTOPILOT_TASKS'
  | 'SITE_MANAGEMENT'
  | 'AUDIT_LEDGER'
  | 'CREDIT_LEDGER'
  | 'PRICING_CONFIG';

export type UsdtNetwork = 'TRC20';

export interface ActionPricingItem {
  action: CreditActionType | string;
  name: string;
  credits: number;
  desc: string;
  enabled?: boolean;
}

export interface UsdtPackage {
  id: string;
  name: string;
  badge?: string;
  usdtAmount: number;
  credits: number;
  bonusCredits?: number;
  popular?: boolean;
}

export interface PricingConfig {
  rate: string;
  trc20Address: string;
  actionPricing: ActionPricingItem[];
  packages: UsdtPackage[];
}

export type CreditTransactionType = 'RECHARGE' | 'CONSUME' | 'REFUND' | 'BONUS';

export type CreditActionType = 
  | 'USDT_TOPUP'
  | 'CRUISE_PIPELINE'
  | 'DRAFT_GENERATE'
  | 'AUTOPILOT_CRUISE'
  | 'COMPETITOR_ANALYSIS'
  | 'SITE_AUDIT'
  | 'REGISTER_BONUS';

export interface CreditTransaction {
  id: string;
  tenantId: string;
  type: CreditTransactionType;
  action: CreditActionType;
  amount: number; // 正数为充值/增加，负数为消耗
  balance: number; // 交易后余额
  description: string;
  createdAt: string;
  txHash?: string;
  usdtAmount?: number;
  network?: UsdtNetwork;
  metadata?: {
    siteId?: string;
    siteName?: string;
    domain?: string;
    draftId?: string;
    keyword?: string;
    taskId?: string;
  };
}

export type AccountRole = 'ADMIN' | 'TENANT';

export interface TenantAccount {
  id: string;
  username: string;
  email: string;
  companyName?: string;
  credits: number;
  totalRechargedUsdt: number;
  totalConsumedCredits: number;
  role: AccountRole;
  createdAt: string;
  avatarUrl?: string;
}

export type OpportunityType = 
  | 'NEW_CONTENT'
  | 'COMPETITOR_DISPLACEMENT'
  | 'RANKING_IMPROVEMENT'
  | 'HIGH_IMPRESSION_LOW_CTR'
  | 'CONTENT_DECAY'
  | 'CONTENT_CANNIBALIZATION'
  | 'INTERNAL_LINK'
  | 'TECHNICAL_RELEASE';

export type OpportunityStatus =
  | 'PROPOSED'
  | 'CALIBRATING'
  | 'APPROVED'
  | 'GENERATING'
  | 'IN_QUALITY_GATE'
  | 'READY_TO_PUBLISH'
  | 'AUTO_PUBLISHED'
  | 'MANUAL_REVIEW'
  | 'PAUSED'
  | 'REJECTED';

export type SearchIntentType = 
  | 'INFORMATIONAL'             // 📘 信息型 (40% 权威科普引流)
  | 'COMMERCIAL_INVESTIGATION'  // ⚖️ 对比调研型 (30% 竞品截流)
  | 'TRANSACTIONAL'             // 💳 交易决策型 (20% 留资转化)
  | 'NAVIGATIONAL';             // 🧭 导航品牌型 (10% 品牌信任)

export type EvergreenHealthStatus = 
  | 'PEAK_RANKING'              // 🟢 处于 Top 1~3 黄金排位
  | 'RE_OPTIMIZED_2026'         // ⚡ 已触发 2026 自动增量更新
  | 'STABLE_GROWTH'             // 📈 持续引流中
  | 'DECAY_WARNING';            // ⚠️ 检测到轻度衰退，建议自愈

export interface IndexingPushStatus {
  baiduPushed: boolean;
  baiduQuotaLeft: number;
  indexNowBroadcasted: boolean;
  googleSitemapPinged: boolean;
  pushedTimestamp?: string;
  responseStatus?: string;
}

export interface LeadCaptureCtaConfig {
  enabled: boolean;
  title: string;
  buttonText: string;
  targetUrl: string;
  calloutNote?: string;
}

export interface SiteHealthDiagnostics {
  restApiStatus: boolean;
  authStatus: boolean;
  sitemapStatus: boolean;
  permalinkStatus: boolean;
  indexNowStatus: boolean;
  lastCheckedAt: string;
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ScoreBreakdown {
  businessValue: number;      // 20%
  searchDemand: number;       // 18%
  winProbability: number;     // 15%
  currentRanking: number;     // 12%
  engagementPotential: number;// 10%
  googleBaiduReuse: number;   // 10%
  internalLinkValue: number;  // 5%
  freshness: number;          // 5%
  dataReliability: number;    // 5%
  riskPenalty: number;        // deduction
  costPenalty: number;        // deduction
  totalScore: number;         // 0-100
}

export interface DemandEvidence {
  sourceType: 'GSC_QUERY' | 'CONTENT_GAP' | 'USER_SEED' | 'IMPRESSION_DECAY' | 'CANNIBALIZATION_ALERT';
  queryOrTopic: string;
  monthlyImpressions?: number;
  currentClicks?: number;
  currentPosition?: number;
  competingUrls?: string[];
  evidenceDescription: string;
  reliabilityConfidence: number; // e.g. 0.95
}

export interface Opportunity {
  id: string;
  siteId: string;
  title: string;
  type: OpportunityType;
  language: Language | string;
  targetKeyword: string;
  category: string;
  searchIntent?: SearchIntentType;
  cannibalizationRiskScore?: number; // 0-100, 0 = no risk
  riskLevel: RiskLevel;
  estimatedMonthlyVisitsGain: number;
  demandEvidence: DemandEvidence;
  scoreBreakdown: ScoreBreakdown;
  status: OpportunityStatus;
  createdAt: string;
  updatedAt: string;
  requiresManualReviewReason?: string;
}

export interface ContentBrief {
  opportunityId: string;
  targetKeyword: string;
  language: Language | string;
  searchIntent: string;
  searchIntentType?: SearchIntentType;
  targetAudience: string;
  recommendedWordCount: number;
  articleStructure: { heading: string; points: string[] }[];
  requiredKnowledgeSources: string[];
  internalLinksToInsert: { anchorText: string; targetUrl: string }[];
  forbiddenTopics: string[];
}

export interface QualityGateResult {
  passed: boolean;
  overallScore: number;          // >= 85 required
  factReliabilityScore: number;  // >= 90 required
  hallucinationFree: boolean;
  languageMatch: boolean;
  sourceCheckPassed: boolean;
  duplicateContentCheck: boolean;
  issues: string[];
  passedChecks: string[];
}

export interface ArticleDraft {
  id: string;
  opportunityId: string;
  siteId: string;
  title: string;
  language: Language | string;
  category: string;
  contentHtml: string;
  summary: string;
  wordCount?: number;
  searchIntent?: SearchIntentType;
  evergreenStatus?: EvergreenHealthStatus;
  lastEvergreenRefreshAt?: string;
  indexingPushStatus?: IndexingPushStatus;
  sourcesUsed: string[];
  qualityGate: QualityGateResult;
  status: 'DRAFT' | 'QUALITY_PASSED' | 'QUALITY_FAILED' | 'PENDING_APPROVAL' | 'PUBLISHED' | 'ROLLED_BACK';
  publishedUrl?: string;
  publishedAt?: string;
  wpPostId?: number;
  createdAt: string;
}

export interface CalibrationStatus {
  isCalibrating: boolean;
  daysRemaining: number;
  totalApprovedRequired: number;
  approvedCount: number;
  rejectedCount: number;
  zeroFactErrorStreak: number;
  autoPublishUnlocked: boolean;
}

export interface AutomatedTask {
  id: string;
  siteId: string;
  siteName: string;
  taskName: string;
  scheduleType: 'DAILY' | 'INTERVAL' | 'WEEKLY';
  scheduleTime: string;
  targetKeywordTopic: string;
  articleCountPerRun: number;
  status: 'ACTIVE' | 'PAUSED';
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
}

export type SiteType = 'WORDPRESS' | 'SHOPIFY' | 'GHOST' | 'WEBFLOW' | 'CUSTOM_REST';

export interface WordPressSite {
  id: string;
  name: string;
  domain: string;
  niche: string;
  siteType?: SiteType;
  siteLanguage: Language | string;
  pagesCount: number;
  connectorStatus: 'CONNECTED' | 'CHECKING' | 'DISCONNECTED' | 'ERROR';
  wpVersion?: string;
  wpUsername?: string;
  wpAppPassword?: string;
  wpRestEndpoint?: string;
  baiduToken?: string;
  indexNowKey?: string;
  pluginInstalled: boolean;
  whitelistedCategories: string[];
  leadCaptureCta?: LeadCaptureCtaConfig;
  healthDiagnostics?: SiteHealthDiagnostics;
  gscConnected: boolean;
  ga4Connected: boolean;
  baiduConnected: boolean;
  autopilotEnabled: boolean;
  weeklyPublishCap: number;
  currentWeeklyPublished: number;
  calibration: CalibrationStatus;
  monthlyBudgetLimit: number; // in USD
  monthlyBudgetUsed: number;
  createdAt: string;
}

export interface KnowledgeSource {
  id: string;
  siteId: string;
  title: string;
  type: 'CLIENT_KB' | 'ORIGINAL_RESEARCH' | 'WHITELISTED_DOMAIN';
  contentSnippet: string;
  urlOrFilename?: string;
  addedAt: string;
}

export interface AuditLogItem {
  id: string;
  siteId: string;
  timestamp: string;
  actor: 'SYSTEM_AUTOPILOT' | 'USER_ADMIN' | 'POLICY_ENGINE';
  action: string;
  target: string;
  result: 'SUCCESS' | 'WARNING' | 'BLOCKED' | 'FAILED';
  details: string;
}

export interface UsageLedgerItem {
  month: string;
  aiTokenCost: number;
  crawlerCost: number;
  publishedArticlesCount: number;
  costPerArticle: number;
  costPerIndexedPage: number;
  budgetLimit: number;
  budgetUsed: number;
}

export interface GrowthMetrics {
  monthlyOrganicVisits: number;
  monthlyVisitsGrowthPct: number;
  top10KeywordsCount: number;
  newTop10KeywordsThisMonth: number;
  newlyIndexedPagesCount: number;
  activeAutopilotTasksCount: number;
  pausedTasksCount: number;
  nextBestOpportunity?: Opportunity;
}

export interface BaiduSubmissionLog {
  id: string;
  url: string;
  submittedAt: string;
  type: 'DAILY_API' | 'SITEMAP';
  status: 'SUBMITTED' | 'INDEXED' | 'PENDING';
  remainQuota: number;
}

export type CompetitorAttackKeywordType = 'ALTERNATIVE' | 'FEATURE_GAP' | 'PAIN_POINT' | 'PRICING_COMPARISON';

export interface CompetitorAttackKeyword {
  keyword: string;
  type: CompetitorAttackKeywordType;
  typeLabel: string;
  intent: string;
  estimatedMonthlyTraffic: number;
  attackAngle: string;
  difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendedH2s: string[];
}

export interface CompetitorAttackAnalysis {
  competitor: string;
  competitorOverview: string;
  competitorWeaknesses: string[];
  attackKeywords: CompetitorAttackKeyword[];
  strategicAdvice: string;
}
