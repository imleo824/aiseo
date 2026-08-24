import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getTasks, createTask, runTaskNow } from '../server/controllers/taskController';
import { createSite, toggleAutopilot, } from '../server/controllers/siteController';
import { approveAndPublishDraft, rollbackDraft } from '../server/controllers/draftController';
import { addSiteKnowledgeSource, getSiteKnowledgeBase } from '../server/controllers/knowledgeController';
import { creditController } from '../server/controllers/creditController';
import { fileTenantRepository } from '../server/infrastructure/persistence/fileTenantRepository';
import { TenantRequest } from '../server/middleware/tenant';
import { Response } from 'express';

// Mock gemini adapter for deterministic fast controller testing
vi.mock('../server/infrastructure/ai/geminiAdapter', () => ({
  geminiAdapter: {
    analyzeSearchDemand: vi.fn().mockResolvedValue({
      searchIntent: '技术选型',
      targetAudience: '架构师',
      recommendedWordCount: 2000,
      suggestedTitle: 'Kubernetes 生产级落地实践',
      estimatedTrafficGain: 2200
    }),
    generateContentBrief: vi.fn().mockResolvedValue({
      opportunityId: 'opp-1',
      targetKeyword: 'K8s',
      language: 'zh-CN',
      searchIntent: '优化',
      targetAudience: '工程师',
      recommendedWordCount: 2000,
      articleStructure: [{ heading: '概述', points: ['要点1'] }],
      requiredKnowledgeSources: [],
      internalLinksToInsert: [],
      forbiddenTopics: []
    }),
    generateArticleAndQualityCheck: vi.fn().mockResolvedValue({
      title: 'Kubernetes 生产级落地实践',
      summary: '本文深度探讨 K8s 部署优化',
      contentHtml: '<h1>K8s 部署</h1><p>内容正文</p>',
      qualityGate: {
        passed: true,
        overallScore: 96,
        factReliabilityScore: 98,
        hallucinationFree: true,
        languageMatch: true,
        sourceCheckPassed: true,
        duplicateContentCheck: true,
        issues: [],
        passedChecks: ['E-E-A-T 达标', 'AEO 结构化数据完备']
      }
    })
  }
}));

function createMockRes(): { res: Response; json: any; status: any } {
  const resData: any = {};
  const res: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      resData.body = data;
      return this;
    }
  };
  return { res, json: () => resData.body, status: () => res.statusCode };
}

describe('Controllers Suite', () => {
  let mockReq: Partial<TenantRequest>;

  beforeEach(async () => {
    mockReq = {
      tenantId: 'tenant-test',
      params: {},
      body: {},
      tenantData: {
        sites: [
          {
            id: 'site-1',
            name: 'Cloud Native Tech',
            domain: 'cloudnative.tech',
            connectorStatus: 'CONNECTED',
            pagesCount: 10,
            calibration: {
              isCalibrating: true,
              approvedCount: 0,
              rejectedCount: 0,
              totalApprovedRequired: 2,
              autoPublishUnlocked: false,
              daysRemaining: 14,
              zeroFactErrorStreak: 0
            },
            niche: 'DevOps',
            siteLanguage: 'zh-CN',
            wpVersion: '6.4.2',
            pluginInstalled: true,
            whitelistedCategories: ['DevOps'],
            gscConnected: true,
            ga4Connected: true,
            baiduConnected: true,
            createdAt: '2026-08-01T00:00:00.000Z'
          }
        ],
        opportunities: [
          {
            id: 'opp-1',
            siteId: 'site-1',
            title: 'Kubernetes 生产级部署优化实践指南',
            type: 'NEW_CONTENT',
            language: 'zh-CN',
            targetKeyword: 'Kubernetes 部署优化',
            category: 'DevOps',
            riskLevel: 'LOW',
            estimatedMonthlyVisitsGain: 2400,
            demandEvidence: {
              sourceType: 'GSC_QUERY',
              queryOrTopic: 'Kubernetes 部署优化',
              evidenceDescription: '高搜索意图关键词',
              reliabilityConfidence: 0.95
            },
            scoreBreakdown: {
              businessValue: 20,
              searchDemand: 18,
              winProbability: 15,
              currentRanking: 12,
              engagementPotential: 10,
              googleBaiduReuse: 10,
              internalLinkValue: 5,
              freshness: 5,
              dataReliability: 5,
              riskPenalty: 0,
              costPenalty: 0,
              totalScore: 100
            },
            status: 'APPROVED',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z'
          }
        ],
        drafts: [
          {
            id: 'draft-1',
            opportunityId: 'opp-1',
            siteId: 'site-1',
            title: 'Kubernetes 生产级部署优化实践指南',
            language: 'zh-CN',
            category: 'DevOps',
            contentHtml: '<h1>Kubernetes 优化指南</h1><p>内容正文</p>',
            summary: '摘要',
            sourcesUsed: [],
            qualityGate: {
              passed: true,
              overallScore: 95,
              factReliabilityScore: 98,
              hallucinationFree: true,
              languageMatch: true,
              sourceCheckPassed: true,
              duplicateContentCheck: true,
              issues: [],
              passedChecks: ['无幻觉校验', '事实核查']
            },
            status: 'PENDING_APPROVAL',
            createdAt: '2026-08-02T00:00:00.000Z'
          }
        ],
        knowledgeSources: [],
        auditLogs: [],
        usageLedger: [],
        baiduLogs: [],
        automatedTasks: []
      }
    };
    fileTenantRepository.saveTenantData('tenant-test', mockReq.tenantData as any);
    await fileTenantRepository.rechargeUsdt('tenant-test', 10, 1000, 'init-tx', 'TRC20');
  });

  it('should create and retrieve tasks in taskController', async () => {
    const { res, json, status } = createMockRes();
    mockReq.body = {
      siteId: 'site-1',
      taskName: '每日自动热点抓取',
      scheduleType: 'DAILY',
      targetKeywordTopic: 'K8s / Cloud Native'
    };

    await createTask(mockReq as TenantRequest, res);
    expect(status()).toBe(201);
    expect(json().task.taskName).toBe('每日自动热点抓取');
    expect(json().task.totalArticles).toBe(0);
    const tenantData = fileTenantRepository.getTenantData('tenant-test');
    expect(tenantData.automatedTasks.length).toBe(1);
    expect(tenantData.automatedTasks[0].totalArticles).toBe(0);

    const { res: getRes, json: getJson } = createMockRes();
    await getTasks(mockReq as TenantRequest, getRes);
    expect(getJson().tasks.length).toBe(1);
    expect(getJson().tasks[0].totalArticles).toBe(0);
  });

  it('should run task now in taskController with auto discovery workflow', async () => {
    const tenantData = fileTenantRepository.getTenantData('tenant-test');
    tenantData.automatedTasks = [
      {
        id: 'task-100',
        siteId: 'site-1',
        siteName: 'Cloud Native Tech',
        taskName: '测试任务',
        scheduleType: 'DAILY',
        scheduleTime: '09:00',
        targetKeywordTopic: 'K8s',
        articleCountPerRun: 1,
        totalArticles: 0,
        status: 'ACTIVE',
        nextRunAt: '',
        createdAt: ''
      }
    ];
    fileTenantRepository.saveTenantData('tenant-test', tenantData);

    mockReq.params = { id: 'task-100' };
    const { res, json } = createMockRes();
    await runTaskNow(mockReq as TenantRequest, res);

    const updatedData = fileTenantRepository.getTenantData('tenant-test');
    expect(json().success).toBe(true);
    expect(updatedData.automatedTasks[0].lastRunAt).toBeDefined();
    expect(updatedData.automatedTasks[0].totalArticles).toBe(1);
    expect(updatedData.auditLogs.length).toBeGreaterThanOrEqual(1);
    expect(updatedData.drafts.length).toBe(2);
  });

  it('should toggle site autopilot status', async () => {
    mockReq.params = { id: 'site-1' };
    const site = fileTenantRepository.getSite('tenant-test', 'site-1');
    if (site) {
      site.calibration.autoPublishUnlocked = true;
      await fileTenantRepository.saveSite('tenant-test', site);
    }
    
    const { res, json } = createMockRes();
    await toggleAutopilot(mockReq as TenantRequest, res);

    expect(json().site.autopilotEnabled).toBe(true);
  });

  it('should approve and publish draft in draftController', async () => {
    mockReq.params = { id: 'draft-1' };
    const { res, json } = createMockRes();
    await approveAndPublishDraft(mockReq as TenantRequest, res);

    expect(json().draft.status).toBe('PUBLISHED');
    expect(json().draft.publishedUrl).toContain('cloudnative.tech');
  });

  it('should rollback draft in draftController', async () => {
    mockReq.params = { id: 'draft-1' };
    const { res, json } = createMockRes();
    await rollbackDraft(mockReq as TenantRequest, res);

    expect(json().draft.status).toBe('ROLLED_BACK');
  });

  it('should validate and create site, preventing duplicate domain', async () => {
    const { res } = createMockRes();
    mockReq.body = {
      domain: 'cloudnative.tech', // already exists
      name: 'Duplicate'
    };
    await expect(createSite(mockReq as TenantRequest, res)).rejects.toThrow();

    // Create unique valid site
    const validRes = createMockRes();
    mockReq.body = {
      domain: 'newsite.io',
      name: 'New Site',
      siteLanguage: 'zh-CN'
    };
    await createSite(mockReq as TenantRequest, validRes.res);
    expect(validRes.status()).toBe(201);
    expect(validRes.json().site.domain).toBe('newsite.io');
  });

  it('should add and retrieve knowledge sources', async () => {
    mockReq.params = { id: 'site-1' };
    mockReq.body = {
      title: 'DevOps 指南',
      contentSnippet: '压测数据表明 QPS 提升 35%'
    };
    const { res, json, status } = createMockRes();
    await addSiteKnowledgeSource(mockReq as TenantRequest, res);
    expect(status()).toBe(201);
    expect(json().knowledgeSource.title).toBe('DevOps 指南');

    const getRes = createMockRes();
    await getSiteKnowledgeBase(mockReq as TenantRequest, getRes.res);
    expect(getRes.json().knowledgeSources.length).toBeGreaterThanOrEqual(1);
  });

  describe('Credit & Pricing RBAC Governance', () => {
    it('should forbid non-admin tenant from updating pricing and package config', async () => {
      // tenant-b is a TENANT role
      const tenantReq: any = {
        headers: { 'x-tenant-id': 'tenant-b' },
        body: {
          rate: '1 USDT = 200 积分'
        }
      };
      const { res, json, status } = createMockRes();
      await creditController.updateConfig(tenantReq, res);

      expect(status()).toBe(403);
      expect(json().success).toBe(false);
      expect(json().message).toContain('权限拒绝');
    });

    it('should forbid non-admin tenant from resetting pricing config', async () => {
      const tenantReq: any = {
        headers: { 'x-tenant-id': 'tenant-b' }
      };
      const { res, json, status } = createMockRes();
      await creditController.resetConfig(tenantReq, res);

      expect(status()).toBe(403);
      expect(json().success).toBe(false);
      expect(json().message).toContain('权限拒绝');
    });

    it('should allow platform ADMIN to update and reset pricing & package config', async () => {
      // tenant-a is ADMIN role
      const adminReq: any = {
        headers: { 'x-tenant-id': 'tenant-a' },
        body: {
          rate: '1 USDT = 150 基础积分',
          trc20Address: 'TAdminNewWallet123456789'
        }
      };
      const { res, json, status } = createMockRes();
      await creditController.updateConfig(adminReq, res);

      expect(status()).toBe(200);
      expect(json().success).toBe(true);
      expect(json().config.rate).toBe('1 USDT = 150 基础积分');

      // Admin reset config
      const resetRes = createMockRes();
      await creditController.resetConfig(adminReq, resetRes.res);
      expect(resetRes.status()).toBe(200);
      expect(resetRes.json().success).toBe(true);
    });

    it('should allow ADMIN to retrieve global transaction logs and usages logs while forbidding non-admin', async () => {
      const nonAdminReq: any = { headers: { 'x-tenant-id': 'tenant-b' } };
      const adminReq: any = { headers: { 'x-tenant-id': 'tenant-a' } };

      // Non-admin check
      const txRes1 = createMockRes();
      await creditController.getAllTransactions(nonAdminReq, txRes1.res);
      expect(txRes1.status()).toBe(403);

      const usageRes1 = createMockRes();
      await creditController.getAllUsages(nonAdminReq, usageRes1.res);
      expect(usageRes1.status()).toBe(403);

      // Admin check
      const txRes2 = createMockRes();
      await creditController.getAllTransactions(adminReq, txRes2.res);
      expect(txRes2.status()).toBe(200);
      expect(txRes2.json().success).toBe(true);
      expect(Array.isArray(txRes2.json().transactions)).toBe(true);

      const usageRes2 = createMockRes();
      await creditController.getAllUsages(adminReq, usageRes2.res);
      expect(usageRes2.status()).toBe(200);
      expect(usageRes2.json().success).toBe(true);
      expect(Array.isArray(usageRes2.json().usages)).toBe(true);
    });

    it('should allow ADMIN to adjust tenant credits and confirm payment status while forbidding non-admin', async () => {
      const nonAdminReq: any = {
        headers: { 'x-tenant-id': 'tenant-b' },
        body: { targetTenantId: 'tenant-b', deltaCredits: 500, reason: '测试上分' }
      };
      const adminAdjustReq: any = {
        headers: { 'x-tenant-id': 'tenant-a' },
        body: { targetTenantId: 'tenant-b', deltaCredits: 500, reason: '管理员客服补偿' }
      };

      // Non-admin adjust check
      const adjRes1 = createMockRes();
      await creditController.adjustCredits(nonAdminReq, adjRes1.res);
      expect(adjRes1.status()).toBe(403);

      // Admin adjust check (topup +500)
      const adjRes2 = createMockRes();
      await creditController.adjustCredits(adminAdjustReq, adjRes2.res);
      expect(adjRes2.status()).toBe(200);
      expect(adjRes2.json().success).toBe(true);
      expect(adjRes2.json().transaction.action).toBe('ADMIN_ADJUSTMENT');

      // Admin confirm payment check
      const adminConfirmReq: any = {
        headers: { 'x-tenant-id': 'tenant-a' },
        body: { txId: adjRes2.json().transaction.id, status: 'CONFIRMED', targetTenantId: 'tenant-b' }
      };
      const confirmRes = createMockRes();
      await creditController.confirmPayment(adminConfirmReq, confirmRes.res);
      expect(confirmRes.status()).toBe(200);
      expect(confirmRes.json().success).toBe(true);
      expect(confirmRes.json().transaction.status).toBe('CONFIRMED');
    });
  });
});
