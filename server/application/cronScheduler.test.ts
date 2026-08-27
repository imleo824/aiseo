import { describe, expect, it, vi } from 'vitest';
import { CronScheduler } from './cronScheduler';

const site = {
  id: 'site-1',
  name: '客户站点',
  domain: 'example.com',
  niche: 'B2B SaaS',
  siteLanguage: 'zh-CN',
  pagesCount: 0,
  connectorStatus: 'CONNECTED',
  wpAppPassword: 'test-application-password',
  pluginInstalled: true,
  whitelistedCategories: ['指南'],
  gscConnected: false,
  ga4Connected: false,
  baiduConnected: false,
  calibration: { isCalibrating: false, autoPublishUnlocked: true, approvedCount: 0, totalApprovedRequired: 0, daysRemaining: 0 },
  createdAt: '2026-08-26T00:00:00.000Z'
};

const task = {
  id: 'task-1',
  siteId: 'site-1',
  siteName: '客户站点',
  taskName: '每日巡航',
  scheduleType: 'DAILY' as const,
  scheduleTime: '09:00',
  targetKeywordTopic: '企业 SEO 自动化',
  articleCountPerRun: 2,
  totalArticles: 0,
  status: 'ACTIVE' as const,
  nextRunAt: '2026-08-26T00:00:00.000Z',
  createdAt: '2026-08-25T00:00:00.000Z'
};

const createRepository = () => {
  const data = {
    sites: [{ ...site }],
    automatedTasks: [{ ...task }],
    knowledgeSources: [{ id: 'kb-1', siteId: 'site-1', title: '客户资料', contentSnippet: '仅使用本客户已确认的产品事实。' }]
  };
  return {
    data,
    repository: {
      getTenantData: vi.fn(() => data),
      getActionCost: vi.fn(() => 20),
      isActionEnabled: vi.fn(() => true),
      consumeCredits: vi.fn(async () => ({ success: true, balance: 80 })),
      refundCredits: vi.fn(async () => ({ success: true, balance: 100 })),
      saveOpportunity: vi.fn(async () => undefined),
      saveDraft: vi.fn(async () => undefined),
      saveSite: vi.fn(async () => undefined),
      appendAuditLog: vi.fn(async () => undefined),
      appendBaiduLog: vi.fn(async () => undefined),
      saveTask: vi.fn(async () => undefined)
    }
  };
};

describe('CronScheduler automated publication', () => {
  it('does not refund when a prerequisite fails before credits were deducted', async () => {
    const { repository } = createRepository();
    const scheduler = new CronScheduler(
      repository as any,
      {} as any,
      {} as any,
      { isConfigured: () => false } as any
    );

    await expect(scheduler.runTaskImmediately('tenant-1', 'task-1')).resolves.toBe(false);
    expect(repository.consumeCredits).not.toHaveBeenCalled();
    expect(repository.refundCredits).not.toHaveBeenCalled();
  });

  it('executes and charges every configured article in an automatic run', async () => {
    const { repository, data } = createRepository();
    const scheduler = new CronScheduler(
      repository as any,
      { publishPost: vi.fn(async () => ({ success: true, publishedUrl: 'https://example.com/articles/1', wpPostId: 1 })) } as any,
      {
        pushToBaidu: vi.fn(async () => ({ success: true, skipped: true, message: '未配置百度 Token' })),
        pushToGoogle: vi.fn(async () => ({ success: true, skipped: true, message: '未配置 Google 凭证' }))
      } as any,
      {
        isConfigured: () => true,
        analyzeSearchDemand: vi.fn(async () => ({ suggestedTitle: '真实客户资料文章', searchIntent: 'INFORMATIONAL' })),
        generateContentBrief: vi.fn(async () => ({
          opportunityId: 'opp-task',
          targetKeyword: '企业 SEO 自动化：核心原理与适用边界',
          language: 'zh-CN',
          searchIntent: 'INFORMATIONAL',
          targetAudience: '企业团队',
          recommendedWordCount: 1600,
          articleStructure: [],
          requiredKnowledgeSources: ['客户资料'],
          internalLinksToInsert: [],
          forbiddenTopics: []
        })),
        generateArticleAndQualityCheck: vi.fn(async () => ({
          title: '真实客户资料文章',
          summary: '摘要',
          contentHtml: `<h2>客户事实</h2><p>${'仅含客户已确认的产品事实与实施细节。'.repeat(70)}</p><h2>实施步骤</h2><p>${'仅根据客户资料执行验证和持续优化。'.repeat(70)}</p>`,
          qualityGate: { passed: true, overallScore: 95, checks: [] }
        }))
      } as any
    );

    await expect(scheduler.runTaskImmediately('tenant-1', 'task-1')).resolves.toBe(true);
    expect(repository.consumeCredits).toHaveBeenCalledTimes(2);
    expect(repository.refundCredits).not.toHaveBeenCalled();
    expect(data.automatedTasks[0].totalArticles).toBe(2);
  });
});
