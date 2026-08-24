import * as fs from 'fs';
import * as path from 'path';
import { 
  initialSites, 
  initialOpportunities, 
  initialDrafts, 
  initialKnowledgeSources, 
  initialAuditLogs, 
  initialUsageLedger,
  initialBaiduLogs 
} from '../../mockData';
import { 
  WordPressSite, 
  Opportunity, 
  ArticleDraft, 
  AuditLogItem, 
  BaiduSubmissionLog, 
  AutomatedTask, 
  TenantAccount, 
  CreditTransaction, 
  CreditActionType, 
  UsdtNetwork, 
  PricingConfig 
} from '../../../src/types/seo';
import { ITenantRepository, TenantData } from '../../domain/repository';
import { logger } from '../../utils/logger';
import { pricingConfigRepository, DEFAULT_PRICING_CONFIG } from './pricingConfigRepository';
import { TenantContext } from '../../utils/tenantContext';

export { DEFAULT_PRICING_CONFIG };

const MAX_LOG_ENTRIES = 500;
const MAX_OPPORTUNITIES = 300;
const MAX_DRAFTS = 200;
const MAX_CREDIT_TXS = 300;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours Session TTL

export class FileTenantRepository implements ITenantRepository {
  private dbPath = path.join(process.cwd(), 'tenant_db.json');
  private tmpDbPath = path.join(process.cwd(), 'tenant_db.json.tmp');
  private datastore = new Map<string, TenantData>();
  private usernameIndex = new Map<string, string>(); // username (lowercase) -> tenantId
  private emailIndex = new Map<string, string>();    // email (lowercase) -> tenantId
  private loaded = false;

  constructor() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    if (this.loaded) return;
    try {
      if (fs.existsSync(this.dbPath)) {
        const fileContent = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(fileContent);
        this.datastore = new Map(Object.entries(parsed));
        logger.info('REPOSITORY', `Loaded database from ${this.dbPath} with ${this.datastore.size} tenants`);
      }
    } catch (e: any) {
      logger.error('REPOSITORY', `Failed to load tenant_db.json: ${e?.message}`);
    }
    this.ensureDefaultTenants();
    this.loaded = true;
  }

  private ensureDefaultTenants(): void {
    if (!this.datastore.has('tenant-a')) {
      this.getTenantData('tenant-a');
    } else {
      const dataA = this.datastore.get('tenant-a')!;
      if (!dataA.passwordHash) dataA.passwordHash = 'admin123';
      if (dataA.account) {
        dataA.account.role = 'ADMIN';
        if (!dataA.account.username) dataA.account.username = 'admin';
      }
    }
    if (!this.datastore.has('tenant-b')) {
      this.getTenantData('tenant-b');
    } else {
      const dataB = this.datastore.get('tenant-b')!;
      if (!dataB.passwordHash) dataB.passwordHash = 'password123';
      if (dataB.account) {
        if (!dataB.account.username) dataB.account.username = 'matrix_seo';
      }
    }
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.usernameIndex.clear();
    this.emailIndex.clear();
    for (const [tenantId, data] of this.datastore.entries()) {
      this.indexTenantAccount(tenantId, data.account);
    }
  }

  private indexTenantAccount(tenantId: string, account?: TenantAccount): void {
    if (!account) return;
    if (account.username) {
      this.usernameIndex.set(account.username.toLowerCase(), tenantId);
    }
    if (account.email) {
      this.emailIndex.set(account.email.toLowerCase(), tenantId);
    }
  }

  public getPricingConfig(): PricingConfig {
    return pricingConfigRepository.getPricingConfig();
  }

  public async savePricingConfig(newConfig: Partial<PricingConfig>): Promise<PricingConfig> {
    return pricingConfigRepository.savePricingConfig(newConfig);
  }

  public async resetPricingConfig(): Promise<PricingConfig> {
    return pricingConfigRepository.resetPricingConfig();
  }

  public getActionCost(action: CreditActionType | string, defaultCost: number): number {
    return pricingConfigRepository.getActionCost(action, defaultCost);
  }

  public isActionEnabled(action: CreditActionType | string): boolean {
    return pricingConfigRepository.isActionEnabled(action);
  }

  private isFlushScheduled = false;
  private isSaving = false;
  private pendingFlushTimer: NodeJS.Timeout | null = null;

  private flushToDisk(immediate = false): void {
    if (immediate || process.env.NODE_ENV === 'test') {
      if (this.pendingFlushTimer) {
        clearTimeout(this.pendingFlushTimer);
        this.pendingFlushTimer = null;
      }
      this.executeDiskWrite(true);
      return;
    }

    if (this.pendingFlushTimer) return;

    this.pendingFlushTimer = setTimeout(() => {
      this.pendingFlushTimer = null;
      this.executeDiskWrite(false);
    }, 100); // 100ms debounce batching for high throughput
  }

  private executeDiskWrite(sync = false): void {
    if (this.isSaving) {
      this.isFlushScheduled = true;
      return;
    }
    this.isSaving = true;

    try {
      const obj = Object.fromEntries(this.datastore);
      const jsonStr = JSON.stringify(obj, null, 2);

      if (!sync && fs.promises && typeof fs.promises.writeFile === 'function') {
        fs.promises.writeFile(this.tmpDbPath, jsonStr, 'utf-8')
          .then(async () => {
            try {
              if (fs.promises.rename) {
                await fs.promises.rename(this.tmpDbPath, this.dbPath);
              } else {
                fs.renameSync(this.tmpDbPath, this.dbPath);
              }
            } catch {
              if (fs.promises.writeFile) {
                await fs.promises.writeFile(this.dbPath, jsonStr, 'utf-8');
              } else {
                fs.writeFileSync(this.dbPath, jsonStr, 'utf-8');
              }
              if (fs.existsSync(this.tmpDbPath)) {
                try { fs.unlinkSync(this.tmpDbPath); } catch {}
              }
            }
          })
          .catch((e) => {
            logger.error('REPOSITORY', `Async atomic save failed: ${e?.message}`);
          })
          .finally(() => {
            this.isSaving = false;
            if (this.isFlushScheduled) {
              this.isFlushScheduled = false;
              this.executeDiskWrite(false);
            }
          });
      } else {
        fs.writeFileSync(this.tmpDbPath, jsonStr, 'utf-8');
        try {
          fs.renameSync(this.tmpDbPath, this.dbPath);
        } catch {
          fs.writeFileSync(this.dbPath, jsonStr, 'utf-8');
        }
        this.isSaving = false;
        if (this.isFlushScheduled) {
          this.isFlushScheduled = false;
          this.executeDiskWrite(true);
        }
      }
    } catch (e: any) {
      this.isSaving = false;
      logger.error('REPOSITORY', `Atomic save failed: ${e?.message}`);
    }
  }

  public async forceFlush(): Promise<void> {
    this.flushToDisk(true);
  }

  private sanitizeTenantData(data: TenantData): TenantData {
    if (data.auditLogs && data.auditLogs.length > MAX_LOG_ENTRIES) {
      data.auditLogs = data.auditLogs.slice(0, MAX_LOG_ENTRIES);
    }
    if (data.baiduLogs && data.baiduLogs.length > MAX_LOG_ENTRIES) {
      data.baiduLogs = data.baiduLogs.slice(0, MAX_LOG_ENTRIES);
    }
    if (data.opportunities && data.opportunities.length > MAX_OPPORTUNITIES) {
      data.opportunities = data.opportunities.slice(0, MAX_OPPORTUNITIES);
    }
    if (data.drafts && data.drafts.length > MAX_DRAFTS) {
      data.drafts = data.drafts.slice(0, MAX_DRAFTS);
    }
    if (data.creditTransactions && data.creditTransactions.length > MAX_CREDIT_TXS) {
      data.creditTransactions = data.creditTransactions.slice(0, MAX_CREDIT_TXS);
    }
    return data;
  }

  public getTenantData(tenantId: string): TenantData {
    this.loadFromFile();
    if (!this.datastore.has(tenantId)) {
      if (tenantId === 'tenant-a') {
        const initialAccount: TenantAccount = {
          id: 'tenant-a',
          username: 'admin',
          email: 'admin@autopilot-seo.pro',
          companyName: '极客矩阵 (Global SEO)',
          credits: 1280,
          totalRechargedUsdt: 50,
          totalConsumedCredits: 3720,
          role: 'ADMIN',
          createdAt: '2026-08-01T00:00:00.000Z',
          avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face'
        };

        const initialTxs: CreditTransaction[] = [
          {
            id: 'tx-init-1',
            tenantId: 'tenant-a',
            type: 'RECHARGE',
            action: 'USDT_TOPUP',
            amount: 5000,
            balance: 5000,
            description: 'USDT 充值到账 (50 USDT / TRC20)',
            createdAt: '2026-08-10T12:00:00.000Z',
            txHash: '0x8f7a2d1e4c9b3a0f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4',
            usdtAmount: 50,
            network: 'TRC20'
          },
          {
            id: 'tx-init-2',
            tenantId: 'tenant-a',
            type: 'CONSUME',
            action: 'CRUISE_PIPELINE',
            amount: -20,
            balance: 4980,
            description: '一键全流程自动发文 (云原生基础设施网)',
            createdAt: '2026-08-20T09:15:00.000Z',
            metadata: { siteName: '云原生基础设施网', keyword: 'Kubernetes v1.31 企业级灰度发布实战' }
          },
          {
            id: 'tx-init-3',
            tenantId: 'tenant-a',
            type: 'CONSUME',
            action: 'COMPETITOR_ANALYSIS',
            amount: -15,
            balance: 4965,
            description: '竞品攻击与流量穿透分析 (Semrush/Ahrefs)',
            createdAt: '2026-08-21T15:30:00.000Z',
            metadata: { siteName: 'AI 开发者前沿社区' }
          }
        ];

        const initialData: TenantData = {
          account: initialAccount,
          passwordHash: 'admin123', // 默认密码简易验证
          sites: JSON.parse(JSON.stringify(initialSites)),
          opportunities: JSON.parse(JSON.stringify(initialOpportunities)),
          drafts: JSON.parse(JSON.stringify(initialDrafts)),
          knowledgeSources: JSON.parse(JSON.stringify(initialKnowledgeSources)),
          auditLogs: JSON.parse(JSON.stringify(initialAuditLogs)),
          usageLedger: JSON.parse(JSON.stringify(initialUsageLedger)),
          baiduLogs: JSON.parse(JSON.stringify(initialBaiduLogs)),
          creditTransactions: initialTxs,
          automatedTasks: [
            {
              id: 'task-1',
              siteId: 'all',
              siteName: '全部已绑定站点',
              taskName: '每日晨间行业热点自动抓取与发布',
              scheduleType: 'DAILY',
              scheduleTime: '09:00',
              targetKeywordTopic: 'K8s / AI 基础设施最新部署实践与成本优化',
              articleCountPerRun: 1,
              totalArticles: 18,
              status: 'ACTIVE',
              lastRunAt: '2026-08-02T09:00:00.000Z',
              nextRunAt: '2026-08-03T09:00:00.000Z',
              createdAt: '2026-08-01T10:00:00.000Z'
            },
            {
              id: 'task-2',
              siteId: 'site-1',
              siteName: '云原生基础设施网',
              taskName: '周一高价值搜索词自动生成发布',
              scheduleType: 'WEEKLY',
              scheduleTime: '每周一 08:30',
              targetKeywordTopic: 'DeepSeek 私有化部署 & vLLM 性能调优指南',
              articleCountPerRun: 2,
              totalArticles: 8,
              status: 'ACTIVE',
              lastRunAt: '2026-07-27T08:30:00.000Z',
              nextRunAt: '2026-08-03T08:30:00.000Z',
              createdAt: '2026-08-01T11:00:00.000Z'
            }
          ]
        };
        this.datastore.set(tenantId, initialData);
        this.flushToDisk();
      } else {
        const isDefaultAdmin = tenantId === 'tenant-admin';
        const defaultAccount: TenantAccount = {
          id: tenantId,
          username: tenantId === 'tenant-b' ? 'matrix_seo' : (tenantId === 'tenant-c' ? 'ecommerce_lab' : tenantId.replace('tenant-', 'user_')),
          email: `${tenantId}@seo-hub.com`,
          companyName: tenantId === 'tenant-b' ? '矩阵出海科技 (租户)' : (tenantId === 'tenant-c' ? '跨境电商智造 (租户)' : `${tenantId} 租户空间`),
          credits: 100, // 新用户默认送 100 积分体验
          totalRechargedUsdt: 0,
          totalConsumedCredits: 0,
          role: isDefaultAdmin ? 'ADMIN' : 'TENANT',
          createdAt: new Date().toISOString()
        };

        const registerTx: CreditTransaction = {
          id: `tx-reg-${Date.now()}`,
          tenantId,
          type: 'RECHARGE',
          action: 'USDT_TOPUP',
          amount: 100,
          balance: 100,
          description: '新租户注册体验金入账 (+100 积分)',
          createdAt: new Date().toISOString()
        };

        const emptyData: TenantData = {
          account: defaultAccount,
          passwordHash: 'password123',
          sites: [],
          opportunities: [],
          drafts: [],
          knowledgeSources: [],
          auditLogs: [],
          usageLedger: [],
          baiduLogs: [],
          automatedTasks: [],
          creditTransactions: [registerTx]
        };
        this.datastore.set(tenantId, emptyData);
        this.flushToDisk();
      }
    }
    return this.datastore.get(tenantId)!;
  }

  public async saveTenantData(tenantId: string, data: TenantData): Promise<void> {
    TenantContext.assertAccess(tenantId);
    this.loadFromFile();
    const sanitized = this.sanitizeTenantData(data);
    this.datastore.set(tenantId, sanitized);
    if (sanitized.account) {
      this.indexTenantAccount(tenantId, sanitized.account);
    }
    this.flushToDisk();
  }

  public getAllTenantIds(): string[] {
    this.loadFromFile();
    // 确保包含默认管理员及演示租户
    if (!this.datastore.has('tenant-a')) {
      this.getTenantData('tenant-a');
    }
    if (!this.datastore.has('tenant-b')) {
      this.getTenantData('tenant-b');
    }
    return Array.from(this.datastore.keys());
  }

  public getAccount(tenantId: string): TenantAccount {
    const data = this.getTenantData(tenantId);
    if (!data.account) {
      data.account = {
        id: tenantId,
        username: tenantId,
        email: `${tenantId}@domain.com`,
        credits: 100,
        totalRechargedUsdt: 0,
        totalConsumedCredits: 0,
        role: (tenantId === 'tenant-a' || tenantId === 'tenant-admin') ? 'ADMIN' : 'TENANT',
        createdAt: new Date().toISOString()
      };
      this.saveTenantData(tenantId, data);
    }
    return data.account;
  }

  public async saveAccount(tenantId: string, account: TenantAccount): Promise<TenantAccount> {
    const data = this.getTenantData(tenantId);
    data.account = account;
    await this.saveTenantData(tenantId, data);
    return account;
  }

  public getCreditTransactions(tenantId: string): CreditTransaction[] {
    const data = this.getTenantData(tenantId);
    return data.creditTransactions || [];
  }

  public async appendCreditTransaction(tenantId: string, tx: CreditTransaction): Promise<CreditTransaction> {
    const data = this.getTenantData(tenantId);
    if (!data.creditTransactions) {
      data.creditTransactions = [];
    }
    data.creditTransactions.unshift(tx);
    await this.saveTenantData(tenantId, data);
    return tx;
  }

  private tenantLocks = new Map<string, Promise<void>>();

  private async withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    let unlock: () => void = () => {};
    const nextLock = new Promise<void>((resolve) => {
      unlock = resolve;
    });

    const currentLock = this.tenantLocks.get(tenantId) || Promise.resolve();
    this.tenantLocks.set(tenantId, currentLock.then(() => nextLock));

    try {
      await currentLock;
      return await fn();
    } finally {
      unlock();
    }
  }

  public async consumeCredits(
    tenantId: string, 
    amount: number, 
    action: CreditActionType, 
    description: string, 
    metadata?: any
  ): Promise<{ success: boolean; balance: number; tx?: CreditTransaction; message?: string }> {
    return this.withTenantLock(tenantId, async () => {
      const data = this.getTenantData(tenantId);
      const account = this.getAccount(tenantId);
      
      if (account.credits < amount) {
        return {
          success: false,
          balance: account.credits,
          message: `积分不足！当前余额: ${account.credits} 积分，本次操作需要: ${amount} 积分。请充值 USDT 兑换积分。`
        };
      }

      account.credits -= amount;
      account.totalConsumedCredits = (account.totalConsumedCredits || 0) + amount;

      const tx: CreditTransaction = {
        id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        tenantId,
        type: 'CONSUME',
        action,
        amount: -amount,
        balance: account.credits,
        description,
        createdAt: new Date().toISOString(),
        metadata
      };

      if (!data.creditTransactions) {
        data.creditTransactions = [];
      }
      data.creditTransactions.unshift(tx);
      data.account = account;
      await this.saveTenantData(tenantId, data);

      logger.info('CREDIT', `Tenant ${tenantId} consumed ${amount} credits for ${action}. Remaining: ${account.credits}`);
      return {
        success: true,
        balance: account.credits,
        tx
      };
    });
  }

  public async refundCredits(
    tenantId: string,
    amount: number,
    action: CreditActionType,
    reason: string,
    metadata?: any
  ): Promise<{ success: boolean; balance: number; tx?: CreditTransaction }> {
    return this.withTenantLock(tenantId, async () => {
      const data = this.getTenantData(tenantId);
      const account = this.getAccount(tenantId);

      account.credits += amount;
      account.totalConsumedCredits = Math.max(0, (account.totalConsumedCredits || 0) - amount);

      if (data.creditTransactions && data.creditTransactions.length > 0) {
        const idx = data.creditTransactions.findIndex(t => t.type === 'CONSUME' && t.action === action && Math.abs(t.amount) === amount);
        if (idx !== -1) {
          data.creditTransactions.splice(idx, 1);
        }
      }

      data.account = account;
      await this.saveTenantData(tenantId, data);

      logger.info('CREDIT_RESTORE', `Tenant ${tenantId} restored ${amount} credits for ${action} (${reason}). New balance: ${account.credits}`);
      return {
        success: true,
        balance: account.credits
      };
    });
  }

  public async rechargeUsdt(
    tenantId: string, 
    usdtAmount: number, 
    credits: number, 
    txHash: string, 
    network: UsdtNetwork
  ): Promise<{ success: boolean; balance: number; tx: CreditTransaction }> {
    const data = this.getTenantData(tenantId);
    const account = this.getAccount(tenantId);

    account.credits += credits;
    account.totalRechargedUsdt = (account.totalRechargedUsdt || 0) + usdtAmount;

    const tx: CreditTransaction = {
      id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      type: 'RECHARGE',
      action: 'USDT_TOPUP',
      amount: credits,
      balance: account.credits,
      description: `USDT 充值 (${usdtAmount} USDT / ${network}) 兑换 ${credits} 积分`,
      createdAt: new Date().toISOString(),
      txHash,
      usdtAmount,
      network
    };

    if (!data.creditTransactions) {
      data.creditTransactions = [];
    }
    data.creditTransactions.unshift(tx);
    data.account = account;
    await this.saveTenantData(tenantId, data);

    logger.info('PAYMENT', `Tenant ${tenantId} recharged ${usdtAmount} USDT (+${credits} credits). New balance: ${account.credits}`);
    return {
      success: true,
      balance: account.credits,
      tx
    };
  }

  public async adjustTenantCredits(
    targetTenantId: string,
    deltaCredits: number,
    reason: string,
    adminTenantId: string
  ): Promise<{ success: boolean; balance: number; account: TenantAccount; tx: CreditTransaction }> {
    this.loadFromFile();
    if (!this.datastore.has(targetTenantId)) {
      throw new Error(`租户 ${targetTenantId} 不存在`);
    }

    const data = this.getTenantData(targetTenantId);
    const account = this.getAccount(targetTenantId);

    const isTopUp = deltaCredits >= 0;
    const absDelta = Math.abs(deltaCredits);

    if (!isTopUp && account.credits < absDelta) {
      throw new Error(`租户积分余额不足 (${account.credits} 积分)，无法下扣 ${absDelta} 积分`);
    }

    account.credits += deltaCredits;
    if (isTopUp) {
      // no change to totalRechargedUsdt unless specified, but keep consistency
    } else {
      account.totalConsumedCredits = (account.totalConsumedCredits || 0) + absDelta;
    }

    const tx: CreditTransaction = {
      id: `tx-adj-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId: targetTenantId,
      type: isTopUp ? 'RECHARGE' : 'CONSUME',
      action: 'ADMIN_ADJUSTMENT',
      amount: deltaCredits,
      balance: account.credits,
      description: `[管理员${isTopUp ? '上分' : '下扣'}] ${reason || '手动调整算力积分'} (操作人: ${adminTenantId})`,
      createdAt: new Date().toISOString(),
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      confirmedBy: adminTenantId
    };

    if (!data.creditTransactions) {
      data.creditTransactions = [];
    }
    data.creditTransactions.unshift(tx);
    data.account = account;
    await this.saveTenantData(targetTenantId, data);

    logger.info('ADMIN_CREDIT_ADJUST', `Admin ${adminTenantId} adjusted tenant ${targetTenantId} credits by ${deltaCredits}. New balance: ${account.credits}`);
    return {
      success: true,
      balance: account.credits,
      account,
      tx
    };
  }

  public async updatePaymentStatus(
    targetTenantId: string,
    txId: string,
    status: 'CONFIRMED' | 'PENDING' | 'REJECTED',
    confirmedBy: string
  ): Promise<{ success: boolean; tx: CreditTransaction }> {
    this.loadFromFile();
    // Search across target tenant or scan all tenants if targetTenantId is not exact
    let tenantIdsToSearch = [targetTenantId];
    if (!this.datastore.has(targetTenantId)) {
      tenantIdsToSearch = Array.from(this.datastore.keys());
    }

    for (const tid of tenantIdsToSearch) {
      const data = this.getTenantData(tid);
      const tx = (data.creditTransactions || []).find(t => t.id === txId);
      if (tx) {
        tx.status = status;
        tx.confirmedAt = new Date().toISOString();
        tx.confirmedBy = confirmedBy;
        await this.saveTenantData(tid, data);
        logger.info('ADMIN_PAYMENT_CONFIRM', `Admin ${confirmedBy} updated payment ${txId} for tenant ${tid} status to ${status}`);
        return { success: true, tx };
      }
    }

    throw new Error(`找不到订单/交易 ID: ${txId}`);
  }

  private activeSessions = new Map<string, { tenantId: string; createdAt: number }>();

  private pruneExpiredSessions(): void {
    const now = Date.now();
    if (this.activeSessions.size > 500) {
      for (const [token, session] of this.activeSessions.entries()) {
        if (now - session.createdAt > SESSION_TTL_MS) {
          this.activeSessions.delete(token);
        }
      }
    }
  }

  public storeSessionToken(token: string, tenantId: string): void {
    this.pruneExpiredSessions();
    this.activeSessions.set(token, { tenantId, createdAt: Date.now() });
  }

  public resolveTenantFromTokenOrHeader(
    token?: string, 
    tenantIdHeader?: string
  ): { tenantId: string; account: TenantAccount; tenantData: TenantData } | null {
    this.loadFromFile();

    // 1. Check active token session map or token pattern match
    if (token && token.trim().length > 0) {
      const cleanToken = token.trim();
      const session = this.activeSessions.get(cleanToken);
      if (session && this.datastore.has(session.tenantId)) {
        const tenantId = session.tenantId;
        return {
          tenantId,
          account: this.getAccount(tenantId),
          tenantData: this.getTenantData(tenantId)
        };
      }

      // Standard token pattern match: token_<tenantId>_<timestamp>
      const match = cleanToken.match(/^token_([a-zA-Z0-9_-]+)_/);
      if (match) {
        const extractedTenantId = match[1];
        if (this.datastore.has(extractedTenantId)) {
          return {
            tenantId: extractedTenantId,
            account: this.getAccount(extractedTenantId),
            tenantData: this.getTenantData(extractedTenantId)
          };
        }
      }
    }

    // 2. Explicit tenant header fallback (for tests or development)
    if (tenantIdHeader && tenantIdHeader.trim().length > 0) {
      const cleanHeaderId = tenantIdHeader.trim();
      if (this.datastore.has(cleanHeaderId)) {
        return {
          tenantId: cleanHeaderId,
          account: this.getAccount(cleanHeaderId),
          tenantData: this.getTenantData(cleanHeaderId)
        };
      } else if (cleanHeaderId === 'tenant-test' || cleanHeaderId === 'tenant-a') {
        return {
          tenantId: cleanHeaderId,
          account: this.getAccount(cleanHeaderId),
          tenantData: this.getTenantData(cleanHeaderId)
        };
      }
    }

    return null;
  }

  public findTenantByEmailOrUsername(identifier: string): { tenantId: string; account: TenantAccount; passwordHash?: string } | undefined {
    this.loadFromFile();
    this.ensureDefaultTenants();
    if (!identifier || typeof identifier !== 'string') return undefined;
    const cleanId = identifier.trim().toLowerCase();

    // O(1) Fast Index Lookup
    let matchedTenantId: string | undefined = undefined;
    if (this.datastore.has(cleanId)) {
      matchedTenantId = cleanId;
    } else if (this.usernameIndex.has(cleanId)) {
      matchedTenantId = this.usernameIndex.get(cleanId);
    } else if (this.emailIndex.has(cleanId)) {
      matchedTenantId = this.emailIndex.get(cleanId);
    }

    if (matchedTenantId && this.datastore.has(matchedTenantId)) {
      const data = this.datastore.get(matchedTenantId)!;
      return {
        tenantId: matchedTenantId,
        account: this.getAccount(matchedTenantId),
        passwordHash: data.passwordHash || 'admin123'
      };
    }

    // O(N) Fallback Scan if indexes miss
    for (const [tenantId, data] of this.datastore.entries()) {
      if (
        tenantId.toLowerCase() === cleanId ||
        (data.account && data.account.username?.toLowerCase() === cleanId) ||
        (data.account && data.account.email?.toLowerCase() === cleanId)
      ) {
        const account = this.getAccount(tenantId);
        return {
          tenantId,
          account,
          passwordHash: data.passwordHash || 'admin123'
        };
      }
    }
    return undefined;
  }

  public async createTenantAccount(account: TenantAccount, passwordHash: string): Promise<TenantAccount> {
    const tenantId = account.id;
    const registerTx: CreditTransaction = {
      id: `tx-reg-${Date.now()}`,
      tenantId,
      type: 'RECHARGE',
      action: 'USDT_TOPUP',
      amount: account.credits,
      balance: account.credits,
      description: '新用户注册体验金入账 (+100 积分)',
      createdAt: new Date().toISOString()
    };

    const newTenantData: TenantData = {
      account,
      passwordHash,
      sites: [],
      opportunities: [],
      drafts: [],
      knowledgeSources: [],
      auditLogs: [],
      usageLedger: [],
      baiduLogs: [],
      automatedTasks: [],
      creditTransactions: [registerTx]
    };

    await this.saveTenantData(tenantId, newTenantData);
    return account;
  }

  public checkAndResetWeeklyPublishCap(site: WordPressSite): boolean {
    const now = Date.now();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (!site.lastWeeklyResetAt) {
      site.lastWeeklyResetAt = new Date().toISOString();
      return true;
    }
    const lastReset = new Date(site.lastWeeklyResetAt).getTime();
    if (isNaN(lastReset) || (now - lastReset) >= WEEK_MS) {
      site.currentWeeklyPublished = 0;
      site.lastWeeklyResetAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  public getSite(tenantId: string, siteId: string): WordPressSite | undefined {
    const data = this.getTenantData(tenantId);
    const site = data.sites.find(s => s.id === siteId);
    if (site) {
      const resetOccurred = this.checkAndResetWeeklyPublishCap(site);
      if (resetOccurred) {
        this.saveSite(tenantId, site).catch(() => {});
      }
    }
    return site;
  }

  public async saveSite(tenantId: string, site: WordPressSite): Promise<WordPressSite> {
    const data = this.getTenantData(tenantId);
    const idx = data.sites.findIndex(s => s.id === site.id);
    if (idx >= 0) {
      data.sites[idx] = site;
    } else {
      data.sites.unshift(site);
    }
    await this.saveTenantData(tenantId, data);
    return site;
  }

  public async removeSite(tenantId: string, siteId: string): Promise<boolean> {
    const data = this.getTenantData(tenantId);
    const beforeLen = data.sites.length;
    data.sites = data.sites.filter(s => s.id !== siteId);
    if (data.sites.length !== beforeLen) {
      await this.saveTenantData(tenantId, data);
      return true;
    }
    return false;
  }

  public getOpportunity(tenantId: string, oppId: string): Opportunity | undefined {
    const data = this.getTenantData(tenantId);
    return data.opportunities.find(o => o.id === oppId);
  }

  public async saveOpportunity(tenantId: string, opp: Opportunity): Promise<Opportunity> {
    const data = this.getTenantData(tenantId);
    const idx = data.opportunities.findIndex(o => o.id === opp.id);
    if (idx >= 0) {
      data.opportunities[idx] = opp;
    } else {
      data.opportunities.unshift(opp);
    }
    await this.saveTenantData(tenantId, data);
    return opp;
  }

  public getDraft(tenantId: string, draftId: string): ArticleDraft | undefined {
    const data = this.getTenantData(tenantId);
    return data.drafts.find(d => d.id === draftId);
  }

  public async saveDraft(tenantId: string, draft: ArticleDraft): Promise<ArticleDraft> {
    const data = this.getTenantData(tenantId);
    const idx = data.drafts.findIndex(d => d.id === draft.id);
    if (idx >= 0) {
      data.drafts[idx] = draft;
    } else {
      data.drafts.unshift(draft);
    }
    await this.saveTenantData(tenantId, data);
    return draft;
  }

  public getTasks(tenantId: string): AutomatedTask[] {
    return this.getTenantData(tenantId).automatedTasks;
  }

  public async saveTask(tenantId: string, task: AutomatedTask): Promise<AutomatedTask> {
    const data = this.getTenantData(tenantId);
    const idx = data.automatedTasks.findIndex(t => t.id === task.id);
    if (idx >= 0) {
      data.automatedTasks[idx] = task;
    } else {
      data.automatedTasks.unshift(task);
    }
    await this.saveTenantData(tenantId, data);
    return task;
  }

  public async deleteTask(tenantId: string, taskId: string): Promise<boolean> {
    const data = this.getTenantData(tenantId);
    const beforeLen = data.automatedTasks.length;
    data.automatedTasks = data.automatedTasks.filter(t => t.id !== taskId);
    if (data.automatedTasks.length !== beforeLen) {
      await this.saveTenantData(tenantId, data);
      return true;
    }
    return false;
  }

  public async appendAuditLog(tenantId: string, log: AuditLogItem): Promise<void> {
    const data = this.getTenantData(tenantId);
    data.auditLogs.unshift(log);
    await this.saveTenantData(tenantId, data);
  }

  public async appendBaiduLog(tenantId: string, log: BaiduSubmissionLog): Promise<void> {
    const data = this.getTenantData(tenantId);
    data.baiduLogs.unshift(log);
    await this.saveTenantData(tenantId, data);
  }
}

export const fileTenantRepository = new FileTenantRepository();
export const tenantStore = fileTenantRepository;

