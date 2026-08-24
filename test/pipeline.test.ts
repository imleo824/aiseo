import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineOrchestrator } from '../server/application/pipelineOrchestrator';
import { eventBus } from '../server/domain/eventBus';
import { fileTenantRepository } from '../server/infrastructure/persistence/fileTenantRepository';

vi.mock('../server/infrastructure/ai/geminiAdapter', () => ({
  geminiAdapter: {
    analyzeSearchDemand: vi.fn().mockResolvedValue({
      searchIntent: '技术选型',
      targetAudience: '架构师',
      recommendedWordCount: 2200,
      suggestedTitle: 'K8s 架构实践',
      estimatedTrafficGain: 2500
    }),
    generateContentBrief: vi.fn().mockResolvedValue({
      opportunityId: 'opp-test',
      targetKeyword: 'K8s',
      language: 'zh-CN',
      searchIntent: '优化',
      targetAudience: '工程师',
      recommendedWordCount: 2200,
      articleStructure: [{ heading: '概述', points: ['要点1'] }],
      requiredKnowledgeSources: [],
      internalLinksToInsert: [],
      forbiddenTopics: []
    }),
    generateArticleAndQualityCheck: vi.fn().mockResolvedValue({
      title: 'K8s 架构实践',
      summary: '摘要',
      contentHtml: '<h1>K8s</h1><p>内容</p>',
      qualityGate: {
        passed: true,
        overallScore: 96,
        factReliabilityScore: 98,
        hallucinationFree: true,
        languageMatch: true,
        sourceCheckPassed: true,
        duplicateContentCheck: true,
        issues: [],
        passedChecks: ['E-E-A-T 达标']
      }
    })
  }
}));

describe('SEO Pipeline Orchestrator & EventBus', () => {
  beforeEach(() => {
    // Seed tenant test data in fileTenantRepository
    const testData = fileTenantRepository.getTenantData('test-tenant');
    testData.sites = [
      {
        id: 'site-orch-1',
        name: 'Tech Site',
        domain: 'techsite.io',
        connectorStatus: 'CONNECTED',
        pagesCount: 5,
        calibration: {
          isCalibrating: false,
          approvedCount: 5,
          rejectedCount: 0,
          totalApprovedRequired: 3,
          autoPublishUnlocked: true,
          daysRemaining: 0,
          zeroFactErrorStreak: 5
        },
        niche: 'Technology',
        siteLanguage: 'zh-CN',
        wpVersion: '6.5.0',
        pluginInstalled: true,
        whitelistedCategories: ['技术干货'],
        gscConnected: true,
        ga4Connected: true,
        baiduConnected: true,
        createdAt: new Date().toISOString()
      }
    ];
    testData.opportunities = [];
    testData.drafts = [];
    testData.auditLogs = [];
    testData.account = {
      id: 'test-tenant',
      username: 'test_user',
      email: 'test@example.com',
      credits: 1000,
      totalRechargedUsdt: 10,
      totalConsumedCredits: 0,
      role: 'TENANT',
      createdAt: new Date().toISOString()
    };
    fileTenantRepository.saveTenantData('test-tenant', testData);
  });

  it('should execute end-to-end SEO pipeline and publish domain events', async () => {
    const eventsCaught: any[] = [];
    const handler = (event: any) => {
      eventsCaught.push(event);
    };
    eventBus.subscribe('*', handler);

    const result = await pipelineOrchestrator.executePipeline({
      tenantId: 'test-tenant',
      siteId: 'site-orch-1',
      keyword: 'K8s 生产实战',
      actor: 'SYSTEM_AUTOPILOT',
      traceId: 'trace-unit-test'
    });

    expect(result.success).toBe(true);
    expect(result.opportunity).toBeDefined();
    expect(result.draft).toBeDefined();
    expect(result.draft?.status).toBe('PUBLISHED');
    expect(result.stagesCompleted).toContain('INTENT_DISCOVERY');
    expect(result.stagesCompleted).toContain('WORDPRESS_DEPLOYMENT');
    expect(result.stagesCompleted).toContain('BAIDU_INDEXING_DISPATCH');

    // Verify events were dispatched
    expect(eventsCaught.some(e => e.type === 'OPPORTUNITY_DISCOVERED')).toBe(true);
    expect(eventsCaught.some(e => e.type === 'ARTICLE_PUBLISHED')).toBe(true);

    eventBus.unsubscribe('*', handler);
  });

  it('should execute batch pipelines across multiple requests with concurrency pool', async () => {
    const batchResults = await pipelineOrchestrator.executeBatchPipelines([
      {
        tenantId: 'test-tenant',
        siteId: 'site-orch-1',
        keyword: 'Batch Task 1',
        actor: 'SYSTEM_AUTOPILOT'
      },
      {
        tenantId: 'test-tenant',
        siteId: 'site-orch-1',
        keyword: 'Batch Task 2',
        actor: 'SYSTEM_AUTOPILOT'
      }
    ], 2);

    expect(batchResults.length).toBe(2);
    expect(batchResults.every(r => r.success)).toBe(true);
  });

  it('should gracefully handle non-existent sites without throwing unhandled exceptions', async () => {
    await expect(pipelineOrchestrator.executePipeline({
      tenantId: 'test-tenant',
      siteId: 'non-existent-site-999',
      keyword: 'Invalid Site Test'
    })).rejects.toThrow(/not found/);
  });
});
