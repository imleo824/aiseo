import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileTenantRepository } from '../server/infrastructure/persistence/fileTenantRepository';
import { creditController } from '../server/controllers/creditController';
import { getSites, getSiteById, createSite, deleteSite, toggleAutopilot } from '../server/controllers/siteController';
import { scanOpportunities, generateArticle } from '../server/controllers/opportunityController';
import { approveAndPublishDraft, rollbackDraft } from '../server/controllers/draftController';
import { getTasks, createTask, runTaskNow, deleteTask } from '../server/controllers/taskController';
import { pipelineOrchestrator } from '../server/application/pipelineOrchestrator';
import { CircuitBreaker, CircuitState } from '../server/infrastructure/resilience/circuitBreaker';
import { eventBus } from '../server/domain/eventBus';
import { TenantRequest } from '../server/middleware/tenant';
import { Response } from 'express';
import { WordPressSite, AutomatedTask, Opportunity, ArticleDraft } from '../src/types/seo';

// Mock gemini adapter for fast deterministic tests
vi.mock('../server/infrastructure/ai/geminiAdapter', () => ({
  geminiAdapter: {
    analyzeSearchDemand: vi.fn().mockResolvedValue({
      searchIntent: '技术选型',
      targetAudience: '架构师',
      recommendedWordCount: 2000,
      suggestedTitle: 'Kubernetes 生产级落地实践',
      estimatedTrafficGain: 2200
    }),
    analyzeCompetitorGap: vi.fn().mockResolvedValue({
      competitorDomain: 'rival-cloud.com',
      competitorStrengths: ['高频发文'],
      competitorWeaknesses: ['缺乏实操深度'],
      uncoveredSearchIntents: ['多集群故障演练'],
      recommendedAttackKeywords: [
        { keyword: 'K8s 灾备容灾方案', searchVolume: 4200, difficulty: 38, priority: 'HIGH', rationale: '对手覆盖度低' }
      ]
    }),
    generateContentBrief: vi.fn().mockResolvedValue({
      opportunityId: 'opp-deep-1',
      targetKeyword: 'K8s 生产实践',
      language: 'zh-CN',
      searchIntent: '技术实战',
      targetAudience: 'SRE / 运维工程师',
      recommendedWordCount: 2500,
      articleStructure: [{ heading: '架构设计', points: ['Control Plane 高可用', 'etcd 调优'] }],
      requiredKnowledgeSources: [],
      internalLinksToInsert: [],
      forbiddenTopics: []
    }),
    generateArticleAndQualityCheck: vi.fn().mockResolvedValue({
      title: 'Kubernetes 生产级高可用集群落地实战',
      summary: '从零构建企业级多可用区 Kubernetes 容灾与可观测性集群体系。',
      contentHtml: '<h1>K8s 高可用实战</h1><p>企业级高可用架构的核心在于控制面与存储层的三可用区部署...</p>',
      qualityGate: {
        passed: true,
        overallScore: 98,
        factReliabilityScore: 99,
        hallucinationFree: true,
        languageMatch: true,
        sourceCheckPassed: true,
        duplicateContentCheck: true,
        issues: [],
        passedChecks: ['E-E-A-T 权威性认证', 'AEO 结构化知识图谱标注', '零幻觉事实核验通过']
      }
    })
  }
}));

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    statusCode: 200,
    status(code: number) {
      statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      body = data;
      return this;
    }
  };
  return {
    res: res as Response,
    getStatusCode: () => statusCode,
    getBody: () => body
  };
}

describe('🎯 Expert Deep Testing Suite: Security, Concurrency, Financial & Resilience', () => {
  const TENANT_ALPHA = 'tenant-expert-alpha';
  const TENANT_BETA = 'tenant-expert-beta';

  const mockSiteTemplate: WordPressSite = {
    id: 'site-alpha-1',
    name: 'Alpha Secret Tech Site',
    domain: 'alpha-secret.tech',
    connectorStatus: 'CONNECTED',
    pagesCount: 20,
    calibration: {
      isCalibrating: false,
      approvedCount: 10,
      rejectedCount: 0,
      totalApprovedRequired: 2,
      autoPublishUnlocked: true,
      daysRemaining: 0,
      zeroFactErrorStreak: 10
    },
    niche: 'DevOps',
    siteLanguage: 'zh-CN',
    wpVersion: '6.4.2',
    pluginInstalled: true,
    whitelistedCategories: ['DevOps'],
    gscConnected: true,
    ga4Connected: true,
    baiduConnected: true,
    autopilotEnabled: true,
    weeklyPublishCap: 10,
    currentWeeklyPublished: 0,
    monthlyBudgetLimit: 500,
    monthlyBudgetUsed: 0,
    createdAt: new Date().toISOString()
  };

  beforeEach(() => {
    // Initialize Alpha tenant with 1000 credits, role ADMIN
    const alphaData = fileTenantRepository.getTenantData(TENANT_ALPHA);
    alphaData.account = {
      id: TENANT_ALPHA,
      username: 'alpha_admin',
      email: 'alpha@enterprise.com',
      companyName: 'Alpha Cloud Corp',
      credits: 1000,
      totalRechargedUsdt: 50,
      totalConsumedCredits: 0,
      role: 'ADMIN',
      createdAt: new Date().toISOString()
    };
    alphaData.sites = [{ ...mockSiteTemplate }];
    alphaData.opportunities = [];
    alphaData.drafts = [];
    alphaData.automatedTasks = [];
    alphaData.creditTransactions = [];
    fileTenantRepository.saveTenantData(TENANT_ALPHA, alphaData);

    // Initialize Beta tenant with 10 credits, role TENANT
    const betaData = fileTenantRepository.getTenantData(TENANT_BETA);
    betaData.account = {
      id: TENANT_BETA,
      username: 'beta_user',
      email: 'beta@starter.com',
      companyName: 'Beta Startup Studio',
      credits: 10, // Low balance for insufficient credit tests
      totalRechargedUsdt: 0,
      totalConsumedCredits: 0,
      role: 'TENANT',
      createdAt: new Date().toISOString()
    };
    betaData.sites = [];
    betaData.opportunities = [];
    betaData.drafts = [];
    betaData.automatedTasks = [];
    betaData.creditTransactions = [];
    fileTenantRepository.saveTenantData(TENANT_BETA, betaData);
  });

  /* =========================================================================
   * 1. Multi-Tenant Isolation & Role Authorization Security (多租户安全与隔离)
   * ========================================================================= */
  describe('🛡️ 1. Multi-Tenant Isolation & Role Authorization Security', () => {
    it('should strictly isolate data and prevent Tenant Beta from viewing Tenant Alpha sites', async () => {
      // Query from Beta perspective
      const betaReq: Partial<TenantRequest> = {
        tenantId: TENANT_BETA,
        tenantData: fileTenantRepository.getTenantData(TENANT_BETA)
      };
      const mockRes = createMockRes();
      await getSites(betaReq as any, mockRes.res as any);

      expect(mockRes.getStatusCode()).toBe(200);
      const sites = mockRes.getBody().sites;
      expect(sites.find((s: WordPressSite) => s.id === 'site-alpha-1')).toBeUndefined();
      expect(sites.length).toBe(0);

      // Direct lookup in Beta repository
      const siteInBeta = fileTenantRepository.getSite(TENANT_BETA, 'site-alpha-1');
      expect(siteInBeta).toBeUndefined();

      // Confirm Alpha can find it
      const siteInAlpha = fileTenantRepository.getSite(TENANT_ALPHA, 'site-alpha-1');
      expect(siteInAlpha).toBeDefined();
      expect(siteInAlpha?.name).toBe('Alpha Secret Tech Site');
    });

    it('should reject non-ADMIN tenant from updating global pricing configuration (403 Forbidden)', async () => {
      const mockReq: any = {
        headers: { 'x-tenant-id': TENANT_BETA },
        body: {
          rate: '1 USDT = 200 基础积分',
          actionPricing: [{ action: 'CRUISE_PIPELINE', credits: 50, desc: 'Hacked' }]
        }
      };
      const mockRes = createMockRes();

      await creditController.updateConfig(mockReq, mockRes.res);

      expect(mockRes.getStatusCode()).toBe(403);
      expect(mockRes.getBody().success).toBe(false);
      expect(mockRes.getBody().message).toMatch(/权限拒绝/);
    });

    it('should allow ADMIN tenant to update pricing configuration and verify persistence', async () => {
      const mockReq: any = {
        headers: { 'x-tenant-id': TENANT_ALPHA },
        body: {
          rate: '1 USDT = 100 基础积分',
          trc20Address: 'TLv5UpdatedAdminAddress1234567890',
          actionPricing: [
            { 
              action: 'CRUISE_PIPELINE', 
              name: '一键全流程发文', 
              credits: 22, 
              desc: '调整后定价',
              enabled: true 
            }
          ]
        }
      };
      const mockRes = createMockRes();

      await creditController.updateConfig(mockReq, mockRes.res);

      expect(mockRes.getStatusCode()).toBe(200);
      expect(mockRes.getBody().success).toBe(true);

      const config = fileTenantRepository.getPricingConfig();
      expect(config.trc20Address).toBe('TLv5UpdatedAdminAddress1234567890');
      const cruisePricing = config.actionPricing?.find(a => a.action === 'CRUISE_PIPELINE');
      expect(cruisePricing?.credits).toBe(22);

      // Restore defaults
      await creditController.resetConfig({ headers: { 'x-tenant-id': TENANT_ALPHA } } as any, createMockRes().res);
    });
  });

  /* =========================================================================
   * 2. Financial Ledger & Credit Deduction Integrity (财务对账与并发防超扣)
   * ========================================================================= */
  describe('💰 2. Financial Ledger & Credit Deduction Integrity', () => {
    it('should reject credit consumption when balance is insufficient', async () => {
      const result = await fileTenantRepository.consumeCredits(
        TENANT_BETA,
        20,
        'CRUISE_PIPELINE',
        'Attempting cruise with only 10 credits'
      );

      expect(result.success).toBe(false);
      expect(result.balance).toBe(10);
      expect(result.message).toMatch(/积分不足/);
    });

    it('should process USDT recharge and accurately create transaction ledger entry', async () => {
      const mockReq: any = {
        headers: { 'x-tenant-id': TENANT_BETA },
        body: {
          usdtAmount: 50,
          txHash: '0xabc123456789deadbeef0987654321',
          network: 'TRC20',
          packageId: 'pkg-50'
        }
      };
      const mockRes = createMockRes();

      await creditController.recharge(mockReq, mockRes.res);

      expect(mockRes.getStatusCode()).toBe(200);
      expect(mockRes.getBody().success).toBe(true);

      const account = fileTenantRepository.getAccount(TENANT_BETA);
      expect(account.totalRechargedUsdt).toBe(50);
      expect(account.credits).toBe(10 + 5500); // 10 initial + 5500 package credits

      const txs = fileTenantRepository.getCreditTransactions(TENANT_BETA);
      const rechargeTx = txs.find(t => t.txHash === '0xabc123456789deadbeef0987654321');
      expect(rechargeTx).toBeDefined();
      expect(rechargeTx?.type).toBe('RECHARGE');
      expect(rechargeTx?.usdtAmount).toBe(50);
      expect(rechargeTx?.amount).toBe(5500);
    });

    it('should prevent race condition during parallel concurrent deductions', async () => {
      const initialCredits = fileTenantRepository.getAccount(TENANT_ALPHA).credits; // 1000 credits
      const costPerAction = 10;
      const concurrentTasks = 15; // Total 150 credits

      const tasks = Array.from({ length: concurrentTasks }).map((_, idx) => {
        return fileTenantRepository.consumeCredits(
          TENANT_ALPHA,
          costPerAction,
          'DRAFT_GENERATE',
          `Concurrent deduction task #${idx + 1}`
        );
      });

      const results = await Promise.all(tasks);
      results.forEach(r => expect(r.success).toBe(true));

      const updatedAccount = fileTenantRepository.getAccount(TENANT_ALPHA);
      expect(updatedAccount.credits).toBe(initialCredits - (costPerAction * concurrentTasks));
      expect(updatedAccount.totalConsumedCredits).toBe(costPerAction * concurrentTasks);
    });
  });

  /* =========================================================================
   * 3. Downstream Fault Tolerance & Pipeline Orchestration
   * ========================================================================= */
  describe('⚡ 3. Fault Tolerance & Pipeline Orchestration', () => {
    it('should orchestrate full 8-stage pipeline successfully and record transactions', async () => {
      const beforeCredits = fileTenantRepository.getAccount(TENANT_ALPHA).credits;

      // Track published event
      let eventDispatched = false;
      const handler = (evt: any) => {
        if (evt.type === 'ARTICLE_PUBLISHED' && evt.tenantId === TENANT_ALPHA) {
          eventDispatched = true;
        }
      };
      eventBus.subscribe('*', handler);

      // Execute pipeline
      const result = await pipelineOrchestrator.executePipeline({
        tenantId: TENANT_ALPHA,
        siteId: 'site-alpha-1',
        keyword: 'Kubernetes 生产容灾方案',
        traceId: 'trace-expert-deep-test'
      });

      eventBus.unsubscribe('*', handler);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toContain('CREDIT_DEDUCTED');
      expect(result.stagesCompleted).toContain('CONTENT_AEO_SYNTHESIS');
      expect(result.stagesCompleted).toContain('QUALITY_GATE_EEAT');
      expect(result.draft).toBeDefined();
      expect(result.draft?.title).toMatch(/Kubernetes/);

      // Verify credit deduction
      const afterCredits = fileTenantRepository.getAccount(TENANT_ALPHA).credits;
      expect(afterCredits).toBe(beforeCredits - 100); // 100 credits consumed for simplified single-article CRUISE_PIPELINE
    });
  });

  /* =========================================================================
   * 4. Circuit Breaker Resilience State Machine (熔断器机制深度核验)
   * ========================================================================= */
  describe('🔌 4. Circuit Breaker Resilience State Machine', () => {
    it('should trip to OPEN state on repeated downstream failures and auto recover', async () => {
      const breaker = new CircuitBreaker({
        name: 'deep-test-breaker',
        failureThreshold: 2,
        recoveryTimeoutMs: 80
      });

      let callAttempts = 0;
      const unstableService = async () => {
        callAttempts++;
        throw new Error('Simulated network timeout');
      };

      // 1st failure
      try { await breaker.execute(unstableService); } catch {}
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      // 2nd failure -> Trips circuit
      try { await breaker.execute(unstableService); } catch {}
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // 3rd call must fail-fast without executing the service
      let serviceExecutedWhileOpen = false;
      try {
        await breaker.execute(async () => {
          serviceExecutedWhileOpen = true;
          return 'ok';
        });
      } catch (err: any) {
        expect(err.message).toMatch(/Circuit is OPEN/);
      }
      expect(serviceExecutedWhileOpen).toBe(false);

      // Wait for recovery window
      await new Promise(resolve => setTimeout(resolve, 100));

      // 4th call: Transitions to HALF_OPEN and succeeds -> back to CLOSED
      const recovered = await breaker.execute(async () => 'Healthy service response');
      expect(recovered).toBe('Healthy service response');
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // 5th call: Second success in HALF_OPEN restores to CLOSED
      const recovered2 = await breaker.execute(async () => 'Healthy service response 2');
      expect(recovered2).toBe('Healthy service response 2');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  /* =========================================================================
   * 5. Opportunity Scanning & Draft Quality Gate (选题与草稿质检)
   * ========================================================================= */
  describe('🚀 5. Opportunity Scanning & Autopilot Tasks Lifecycle', () => {
    it('should scan opportunities and generate high-confidence topics', async () => {
      const mockReq: Partial<TenantRequest> = {
        tenantId: TENANT_ALPHA,
        params: { id: 'site-alpha-1' },
        body: { keyword: 'Kubernetes v1.31 升级' }
      };
      const mockRes = createMockRes();

      await scanOpportunities(mockReq as any, mockRes.res as any);

      expect(mockRes.getStatusCode()).toBe(200);
      const opp = mockRes.getBody().opportunity;
      expect(opp).toBeDefined();
      expect(opp.scoreBreakdown.totalScore).toBeGreaterThan(80);
      expect(opp.demandEvidence).toBeDefined();
    });

    it('should create automated task and trigger runTaskNow immediately', async () => {
      const taskReq: Partial<TenantRequest> = {
        tenantId: TENANT_ALPHA,
        tenantData: fileTenantRepository.getTenantData(TENANT_ALPHA),
        body: {
          siteId: 'site-alpha-1',
          taskName: '每日自动化 SEO 巡航发文',
          scheduleType: 'DAILY',
          scheduleTime: '每天 08:30',
          targetKeywordTopic: 'vLLM 生产部署优化',
          articleCountPerRun: 1,
          status: 'ACTIVE'
        }
      };
      const taskRes = createMockRes();
      await createTask(taskReq as any, taskRes.res as any);

      expect(taskRes.getStatusCode()).toBe(201);
      const createdTask: AutomatedTask = taskRes.getBody().task;
      expect(createdTask.id).toBeDefined();
      expect(createdTask.taskName).toBe('每日自动化 SEO 巡航发文');

      // Trigger manual execution
      const runReq: Partial<TenantRequest> = {
        tenantId: TENANT_ALPHA,
        tenantData: fileTenantRepository.getTenantData(TENANT_ALPHA),
        params: { id: createdTask.id }
      };
      const runRes = createMockRes();
      await runTaskNow(runReq as any, runRes.res as any);

      expect(runRes.getStatusCode()).toBe(200);
      expect(runRes.getBody().success).toBe(true);
      expect(runRes.getBody().task.lastRunAt).toBeDefined();
    });
  });
});
