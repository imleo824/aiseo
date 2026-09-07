import { expect, test, type Page } from '@playwright/test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000002';
const programId = '30000000-0000-4000-8000-000000000003';
const runId = '40000000-0000-4000-8000-000000000004';

const stages = (active = false) => [
  { id: 'stage-1', runId, siteId, stage: 'UNDERSTAND', status: active ? 'COMPLETED' : 'PENDING', summary: active ? '已读取 128 个公开页面并完成技术审计。' : undefined, processedCount: active ? 128 : 0, totalCount: active ? 128 : 0, evidence: active ? [{ type: 'SITE_SNAPSHOT' }] : [] },
  { id: 'stage-2', runId, siteId, stage: 'DISCOVER', status: active ? 'RUNNING' : 'PENDING', summary: active ? '正在用真实搜索数据评分候选机会。' : undefined, processedCount: active ? 6 : 0, totalCount: active ? 12 : 0, evidence: active ? [{ type: 'DATAFORSEO_SNAPSHOT' }] : [] },
  { id: 'stage-3', runId, siteId, stage: 'DECIDE', status: 'PENDING', processedCount: 0, evidence: [] },
  { id: 'stage-4', runId, siteId, stage: 'EXECUTE', status: 'PENDING', processedCount: 0, evidence: [] },
  { id: 'stage-5', runId, siteId, stage: 'LEARN', status: 'PENDING', processedCount: 0, evidence: [] }
];

const installAuthenticatedSession = async (page: Page) => {
  await page.addInitScript(({ expiresAt }) => {
    const session = {
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDUiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDA3MDkwODgwMH0.signature',
      refresh_token: 'playwright-refresh-token',
      expires_in: 3600,
      expires_at: expiresAt,
      token_type: 'bearer',
      user: {
        id: '50000000-0000-4000-8000-000000000005',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'owner@example.test',
        email_confirmed_at: '2026-09-01T00:00:00.000Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: '2026-09-01T00:00:00.000Z'
      }
    };
    localStorage.setItem('sb-test-auth-token', JSON.stringify(session));
  }, { expiresAt: Math.floor(Date.now() / 1000) + 86_400 });
};

const installBusinessApi = async (page: Page) => {
  let started = false;
  let submittedBody: unknown;
  let idempotencyKey = '';
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (method === 'GET' && path === '/api/v1/me') return reply({
      profile: { id: '50000000-0000-4000-8000-000000000005', email: 'owner@example.test', displayName: 'tenant-a', platformRole: 'USER' },
      organizations: [{ id: organizationId, name: 'Tenant A', creditBalanceMicros: '11090000000', role: 'OWNER' }]
    });
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites`) return reply([{
      id: siteId, name: 'TechPulse Media', domain: 'https://example.com', language: 'zh-CN', wordpressStatus: 'CONNECTED', wordpressUser: 'editor', wordpressVerifiedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', integrations: []
    }]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/drafts`) return reply([]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/ledger`) return reply({ balanceMicros: '11090000000', heldMicros: '0', availableMicros: '11090000000', entries: [] });
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/growth-programs`) return reply([]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/growth-status`) return reply(started ? {
      program: { id: programId, siteId, mode: 'ONCE', inputType: 'KEYWORD', inputValue: 'enterprise crm', status: 'ACTIVE', deliveredRunCount: 0, consecutiveWins: 0, createdAt: '2026-09-06T00:00:00.000Z' },
      run: { id: runId, siteId, programId, trigger: 'USER', status: 'RUNNING', currentStage: 'DISCOVER', stages: stages(true), createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:01:00.000Z' },
      action: null,
      stages: stages(true),
      blocker: null,
      measurement: { gscConnected: false, trafficClaimAllowed: false }
    } : { program: null, run: null, action: null, stages: [], blocker: null, measurement: { gscConnected: false, trafficClaimAllowed: false } });
    if (method === 'POST' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/growth-programs`) {
      started = true;
      submittedBody = request.postDataJSON();
      idempotencyKey = request.headers()['idempotency-key'] || '';
      const submittedInput = (submittedBody as { input: { type: string; value: string } }).input;
      return reply({
        program: { id: programId, siteId, mode: 'ONCE', inputType: submittedInput.type, inputValue: submittedInput.value, status: 'ACTIVE', deliveredRunCount: 0, consecutiveWins: 0, createdAt: '2026-09-06T00:00:00.000Z' },
        run: { id: runId, siteId, programId, trigger: 'USER', status: 'QUEUED', currentStage: 'UNDERSTAND', stages: stages(false), createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' },
        job: { id: '60000000-0000-4000-8000-000000000006', type: 'GROWTH_RUN', status: 'QUEUED', createdAt: '2026-09-06T00:00:00.000Z' }
      }, 201);
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNMOCKED', message: `${method} ${path}`, traceId: 'e2e' } }) });
  });
  return { submitted: () => submittedBody, idempotencyKey: () => idempotencyKey };
};

test.beforeEach(async ({ page }) => {
  await installAuthenticatedSession(page);
});

for (const scenario of [
  { name: '关键词', tab: null, placeholder: '例如：2026年企业级高可用架构实操指南...', type: 'KEYWORD', value: '企业 CRM SEO' },
  { name: '参考文章', tab: '参考文章', placeholder: 'https://example.com/blog/...（系统不会近似改写或复制）', type: 'REFERENCE_URL', value: 'https://reference.example.com/research' },
  { name: '竞品站点', tab: '对标竞品', placeholder: 'https://competitor.com', type: 'COMPETITOR_SITE', value: 'https://competitor.example.com' }
] as const) {
  test(`${scenario.name}可以一键创建可恢复的真实任务`, async ({ page }) => {
    const fixture = await installBusinessApi(page);
    await page.goto('/');
    await expect(page.getByText('手动执行', { exact: true }).first()).toBeVisible();
    await expect(page.locator('select').filter({ hasText: 'TechPulse Media' })).toHaveValue(siteId);
    if (scenario.tab) await page.getByRole('button', { name: scenario.tab }).click();
    await page.getByPlaceholder(scenario.placeholder).fill(scenario.value);
    await page.getByRole('button', { name: /开始执行|针对|以参考文章/ }).click();
    await expect.poll(() => fixture.submitted()).toEqual({ mode: 'ONCE', input: { type: scenario.type, value: scenario.value } });
    expect(fixture.idempotencyKey()).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.getByText('正在用真实搜索数据评分候选机会。')).toBeVisible();
    await expect(page.getByRole('button', { name: /发现机会/ })).toContainText('执行中');
    await page.reload();
    await expect(page.getByText('正在用真实搜索数据评分候选机会。')).toBeVisible();
    await page.getByRole('button', { name: /了解网站/ }).click();
    await expect(page.getByText('了解网站 · 真实执行证据')).toBeVisible();
    await expect(page.getByText('SITE_SNAPSHOT', { exact: true })).toBeVisible();
  });
}
