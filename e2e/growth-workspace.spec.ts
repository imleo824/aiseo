import { expect, test, type Page } from '@playwright/test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const siteId = '20000000-0000-4000-8000-000000000002';
const programId = '30000000-0000-4000-8000-000000000003';
const runId = '40000000-0000-4000-8000-000000000004';
const paymentPackageId = 'starter';

const stages = (active = false) => [
  { id: 'stage-1', runId, siteId, stage: 'UNDERSTAND', status: active ? 'COMPLETED' : 'PENDING', summary: active ? '已读取 128 个公开页面并完成技术审计。' : undefined, processedCount: active ? 128 : 0, totalCount: active ? 128 : 0, evidence: active ? [{ type: 'SITE_SNAPSHOT' }] : [] },
  { id: 'stage-2', runId, siteId, stage: 'DISCOVER', status: active ? 'RUNNING' : 'PENDING', summary: active ? '正在用真实搜索数据评分候选机会。' : undefined, processedCount: active ? 6 : 0, totalCount: active ? 12 : 0, evidence: active ? [{ type: 'DATAFORSEO_SNAPSHOT' }] : [] },
  { id: 'stage-3', runId, siteId, stage: 'DECIDE', status: 'PENDING', processedCount: 0, evidence: [] },
  { id: 'stage-4', runId, siteId, stage: 'EXECUTE', status: 'PENDING', processedCount: 0, evidence: [] },
  { id: 'stage-5', runId, siteId, stage: 'LEARN', status: 'PENDING', processedCount: 0, evidence: [] }
];

const accessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDUiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6NDA3MDkwODgwMH0.signature';
const authUser = {
  id: '50000000-0000-4000-8000-000000000005',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  email_confirmed_at: '2026-09-01T00:00:00.000Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-09-01T00:00:00.000Z'
};

const installAuthApi = async (page: Page) => {
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        refresh_token: 'playwright-refresh-token',
        expires_in: 86_400,
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        token_type: 'bearer',
        user: authUser
      })
    });
  });
};

const openAuthenticatedWorkspace = async (page: Page) => {
  await page.goto('/');
  await page.getByLabel('工作邮箱').fill('owner@example.test');
  await page.getByLabel('密码', { exact: true }).fill('short123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始执行', exact: true })).toBeVisible();
};

const installBusinessApi = async (page: Page) => {
  let started = false;
  let submittedBody: unknown;
  let idempotencyKey = '';
  let paymentIntentRequests = 0;
  let paymentIntentBody: unknown;
  let wordpressVerificationRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data }) });

    if (method === 'GET' && path === '/api/v1/me') return reply({
      profile: { id: '50000000-0000-4000-8000-000000000005', email: 'owner@example.test', displayName: 'tenant-a', platformRole: 'USER', createdAt: '2026-09-01T00:00:00.000Z' },
      organizations: [{ id: organizationId, name: 'Tenant A', creditBalanceMicros: '11090000000', totalRechargedMicros: '11090000000', totalConsumedMicros: '0', role: 'OWNER' }]
    });
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites`) return reply([{
      id: siteId, name: 'TechPulse Media', domain: 'https://example.com', language: 'zh-CN', wordpressStatus: 'CONNECTED', wordpressUser: 'editor', wordpressVerifiedAt: '2026-09-01T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', integrations: []
    }]);
    if (method === 'POST' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/test-connection`) {
      wordpressVerificationRequests += 1;
      return reply({ connected: true, user: 'editor', siteName: 'TechPulse Media', compatibility: { mode: 'FULL_AUTO' } });
    }
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/drafts`) return reply([]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/ledger`) return reply({ balanceMicros: '11090000000', heldMicros: '0', availableMicros: '11090000000', entries: [] });
    if (method === 'GET' && path === '/api/v1/pricing') return reply({
      packages: [{ id: paymentPackageId, name: '入门套餐', baseAmountMicros: '50000000', creditMicros: '50000000', active: true }],
      actions: [],
      customPricing: { active: true, minAmountMicros: '10000000', maxAmountMicros: '10000000000', creditsPerUsdtMicros: '100000000' }
    });
    if (method === 'POST' && path === `/api/v1/organizations/${organizationId}/payment-intents`) {
      paymentIntentRequests += 1;
      paymentIntentBody = request.postDataJSON();
      const isCustom = 'customAmountMicros' in (paymentIntentBody as Record<string, unknown>);
      return reply({
        paymentIntent: {
          id: '70000000-0000-4000-8000-000000000007',
          packageId: isCustom ? null : paymentPackageId,
          pricingSource: isCustom ? 'CUSTOM' : 'PACKAGE',
          network: 'TRC20',
          recipientAddress: 'TTestRecipientAddress1234567890',
          baseAmountUsdt: isCustom ? '80' : '50',
          expectedAmountUsdt: isCustom ? '80.000001' : '50.000001',
          creditMicros: isCustom ? '8000000000' : '50000000',
          status: 'AWAITING_TRANSFER',
          expiresAt: '2026-09-21T12:30:00.000Z'
        }
      }, 201);
    }
    if (method === 'GET' && path === '/api/v1/me/export') return reply({
      schemaVersion: 'personal-data-export-1',
      exportedAt: '2026-09-20T00:00:00.000Z',
      scope: 'CURRENT_PROFILE_ONLY',
      profile: { id: authUser.id, email: authUser.email }
    });
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/growth-programs`) return reply([]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/growth-programs`) return reply([]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/growth-statuses`) return reply([{ siteId, status: started ? {
      program: { id: programId, siteId, mode: 'ONCE', inputs: [{ id: 'input-1', type: 'KEYWORD', value: 'enterprise crm', position: 0 }], status: 'ACTIVE', deliveredRunCount: 0, consecutiveWins: 0, createdAt: '2026-09-06T00:00:00.000Z' },
      run: { id: runId, siteId, programId, trigger: 'USER', status: 'RUNNING', currentStage: 'DISCOVER', stages: stages(true), createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:05.000Z' },
      action: null,
      stages: stages(true),
      blocker: null,
      measurement: { gscConnected: false, lastSyncedAt: null, trafficClaimAllowed: false, targetUrl: null },
      wordpressCompatibility: { mode: 'FULL_AUTO', supportedActions: ['CREATE_CONTENT'], blockedActions: [], blockReasons: [], lastCheckedAt: '2026-09-06T00:00:00.000Z' }
    } : {
      program: null, run: null, action: null, stages: [], blocker: null,
      measurement: { gscConnected: false, lastSyncedAt: null, trafficClaimAllowed: false, targetUrl: null },
      wordpressCompatibility: { mode: 'FULL_AUTO', supportedActions: ['CREATE_CONTENT'], blockedActions: [], blockReasons: [], lastCheckedAt: '2026-09-06T00:00:00.000Z' }
    } }]);
    if (method === 'GET' && path === `/api/v1/organizations/${organizationId}/sites/${siteId}/growth-status`) return reply(started ? {
      program: { id: programId, siteId, mode: 'ONCE', inputs: [{ id: 'input-1', type: 'KEYWORD', value: 'enterprise crm', position: 0 }], status: 'ACTIVE', deliveredRunCount: 0, consecutiveWins: 0, createdAt: '2026-09-06T00:00:00.000Z' },
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
      const submittedInputs = (submittedBody as { inputs: Array<{ type: string; value: string }> }).inputs;
      return reply({
        program: { id: programId, siteId, mode: 'ONCE', inputs: submittedInputs.map((input, position) => ({ id: `input-${position}`, ...input, position })), status: 'ACTIVE', deliveredRunCount: 0, consecutiveWins: 0, createdAt: '2026-09-06T00:00:00.000Z' },
        run: { id: runId, siteId, programId, trigger: 'USER', status: 'QUEUED', currentStage: 'UNDERSTAND', stages: stages(false), createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z' },
        job: { id: '60000000-0000-4000-8000-000000000006', type: 'GROWTH_RUN', status: 'QUEUED', createdAt: '2026-09-06T00:00:00.000Z' }
      }, 202);
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNMOCKED', message: `${method} ${path}`, traceId: 'e2e' } }) });
  });
  return {
    submitted: () => submittedBody,
    idempotencyKey: () => idempotencyKey,
    paymentIntentRequests: () => paymentIntentRequests,
    paymentIntentBody: () => paymentIntentBody,
    wordpressVerificationRequests: () => wordpressVerificationRequests
  };
};

test.beforeEach(async ({ page }) => {
  await installAuthApi(page);
});

test('登录注册页只展示有效的必要内容', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('PRODUCTION', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '可接受使用' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'USDT 规则' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '服务条款' })).toBeVisible();
  await expect(page.getByRole('link', { name: '隐私政策' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '显示密码' })).toBeVisible();
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '创建新账号' }).click();
  await expect(page.getByLabel('姓名')).toHaveCount(0);
  await expect(page.getByLabel('工作邮箱')).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
});

test('登录失败显示可操作提示而不是供应商内部错误', async ({ page }) => {
  await page.route('**/auth/v1/token?grant_type=password', (route) => route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'invalid_credentials',
      error_code: 'invalid_credentials',
      msg: 'Invalid login credentials'
    })
  }));
  await page.goto('/');
  await page.getByLabel('工作邮箱').fill('owner@example.test');
  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确，请重新输入。');
  await expect(page.getByText('Invalid login credentials')).toHaveCount(0);
});

test('公开法律文件可读且不暴露加密乱码', async ({ page }) => {
  await page.goto('/legal/terms');
  await expect(page.getByRole('heading', { name: 'TuiTui 推推服务条款', level: 1 })).toBeVisible();
  await expect(page.getByText('DRMONE')).toHaveCount(0);
  await expect(page.getByText(/不承诺特定关键词排名/)).toBeVisible();
  await page.getByRole('link', { name: '返回登录' }).click();
  await expect(page.getByRole('heading', { name: '登录工作区' })).toBeVisible();
});

test('WordPress 授权返回后自动验证并立即清理回调参数', async ({ page }) => {
  const fixture = await installBusinessApi(page);
  await page.goto(`/?wordpress=verifying&siteId=${siteId}&organizationId=${organizationId}`);
  await page.getByLabel('工作邮箱').fill('owner@example.test');
  await page.getByLabel('密码', { exact: true }).fill('short123');
  await page.getByRole('button', { name: '登录', exact: true }).click();

  await expect.poll(() => fixture.wordpressVerificationRequests()).toBe(1);
  await expect(page).toHaveURL(/\?view=SITE_MANAGEMENT$/);
  await expect(page).not.toHaveURL(/wordpress=|siteId=|organizationId=/);
  await expect(page.getByText('WordPress 已连接，系统已完成权限与兼容能力检测。')).toBeVisible();
});

test('充值页先选择套餐或自定义金额，提交后展示完整转账信息', async ({ page }) => {
  const fixture = await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  await page.getByRole('button', { name: '我的账单', exact: true }).first().click();
  await page.getByRole('button', { name: '立即充值', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'USDT 充值' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('入门套餐', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /自定义金额/ })).toBeVisible();
  await expect.poll(() => fixture.paymentIntentRequests()).toBe(0);

  await dialog.getByRole('button', { name: /自定义金额/ }).click();
  await dialog.getByLabel('自定义充值金额（整数 USDT）').fill('80');
  await dialog.getByRole('button', { name: '确认金额并查看充值信息' }).click();
  await expect(dialog.getByText('80.000001', { exact: true })).toBeVisible();
  await expect(dialog.getByText('TTestRecipientAddress1234567890', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /确认创建.*充值订单/ })).toHaveCount(0);
  await expect.poll(() => fixture.paymentIntentRequests()).toBe(1);
  expect(fixture.paymentIntentBody()).toEqual({ customAmountMicros: '80000000' });
});

test('导航、浏览器返回与未提交的增长线索都能恢复', async ({ page }) => {
  await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  const keywordInput = page.getByLabel('关键词或主题，每行一个');
  await keywordInput.fill('需要保留的增长线索');

  await page.getByRole('button', { name: '我的站点' }).first().click();
  await expect(page).toHaveURL(/\?view=SITE_MANAGEMENT$/);
  await expect(page.getByText('站点列表 (1)')).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/view=/);
  await expect(keywordInput).toHaveValue('需要保留的增长线索');

  await page.reload();
  await expect(page.getByLabel('关键词或主题，每行一个')).toHaveValue('需要保留的增长线索');
});

test('充值弹窗支持键盘关闭并把焦点交还触发按钮', async ({ page }) => {
  await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  await page.getByRole('button', { name: '我的账单', exact: true }).first().click();
  const rechargeButton = page.getByRole('button', { name: '立即充值', exact: true });
  await rechargeButton.click();
  await expect(page.getByRole('button', { name: '关闭充值面板' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'USDT 充值' })).toHaveCount(0);
  await expect(rechargeButton).toBeFocused();
});

for (const scenario of [
  { name: '关键词', tab: null, placeholder: /企业级高可用架构/, type: 'KEYWORD', value: '企业 CRM SEO' },
  { name: '参考文章', tab: '参考文章', placeholder: /example.com\/article-a/, type: 'REFERENCE_URL', value: 'https://reference.example.com/research' },
  { name: '竞品站点', tab: '竞品网站', placeholder: /competitor-a.com/, type: 'COMPETITOR_SITE', value: 'https://competitor.example.com' }
] as const) {
  test(`${scenario.name}可以一键创建可恢复的真实任务`, async ({ page }) => {
    const fixture = await installBusinessApi(page);
    await openAuthenticatedWorkspace(page);
    await expect(page.locator('select').filter({ hasText: 'TechPulse Media' })).toHaveValue(siteId);
    if (scenario.tab) await page.getByRole('tab', { name: scenario.tab, exact: true }).click();
    await page.getByPlaceholder(scenario.placeholder).fill(scenario.value);
    await page.getByRole('button', { name: '开始执行', exact: true }).click();
    await expect.poll(() => fixture.submitted()).toEqual({ mode: 'ONCE', inputs: [{ type: scenario.type, value: scenario.value }] });
    expect(fixture.idempotencyKey()).toMatch(/^[0-9a-f-]{36}$/i);
    const discoverStage = page.getByRole('button', { name: /发现机会/ });
    await expect(discoverStage).toContainText('执行中');
    await discoverStage.click();
    await expect(page.getByText('正在用真实搜索数据评分候选机会。')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /发现机会/ }).click();
    await expect(page.getByText('正在用真实搜索数据评分候选机会。')).toBeVisible();
    await page.getByRole('button', { name: /了解网站/ }).click();
    await expect(page.getByText('了解网站详情')).toBeVisible();
    await expect(page.getByText('已记录依据 1', { exact: true })).toBeVisible();
  });
}

test('关键词、参考文章与竞品可以组合成同一个增长程序', async ({ page }) => {
  const fixture = await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  await page.getByPlaceholder(/企业级高可用架构/).fill('企业 CRM SEO\nCRM 获客');
  await page.getByRole('tab', { name: '参考文章', exact: true }).click();
  await page.getByPlaceholder(/example.com\/article-a/).fill('https://reference.example.com/research');
  await page.getByRole('tab', { name: '竞品网站', exact: true }).click();
  await page.getByPlaceholder(/competitor-a.com/).fill('https://competitor-a.example.com\nhttps://competitor-b.example.com');
  await page.getByRole('button', { name: '开始执行', exact: true }).click();
  await expect.poll(() => fixture.submitted()).toEqual({
    mode: 'ONCE',
    inputs: [
      { type: 'KEYWORD', value: '企业 CRM SEO' },
      { type: 'KEYWORD', value: 'CRM 获客' },
      { type: 'REFERENCE_URL', value: 'https://reference.example.com/research' },
      { type: 'COMPETITOR_SITE', value: 'https://competitor-a.example.com' },
      { type: 'COMPETITOR_SITE', value: 'https://competitor-b.example.com' }
    ]
  });
});

test('持续增长与一次性执行使用同一套组合输入契约', async ({ page }) => {
  const fixture = await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  await page.getByRole('button', { name: '自动执行', exact: true }).click();
  await page.getByRole('button', { name: '新建自动计划' }).click();
  await page.getByPlaceholder('每行一个，可输入多个').fill('wordpress seo\n内容增长');
  const urlInputs = page.getByPlaceholder('每行一个完整 HTTPS 地址，可不填');
  await urlInputs.nth(0).fill('https://reference.example.com/guide');
  await urlInputs.nth(1).fill('https://competitor.example.com');
  await page.getByRole('button', { name: '创建计划' }).click();
  await expect.poll(() => fixture.submitted()).toEqual({
    mode: 'CONTINUOUS',
    inputs: [
      { type: 'KEYWORD', value: 'wordpress seo' },
      { type: 'KEYWORD', value: '内容增长' },
      { type: 'REFERENCE_URL', value: 'https://reference.example.com/guide' },
      { type: 'COMPETITOR_SITE', value: 'https://competitor.example.com' }
    ]
  });
});

test('账号数据页可导出数据且删除操作必须精确确认邮箱', async ({ page }) => {
  await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);
  await page.getByRole('button', { name: '账号与数据' }).click();
  await expect(page.getByRole('heading', { name: '导出个人数据' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载数据副本' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tuitui-personal-data-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText('个人数据导出文件已生成。')).toBeVisible();

  const deleteButton = page.getByRole('button', { name: '永久删除账号' });
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel(/输入当前邮箱以确认/).fill('someone-else@example.test');
  await expect(deleteButton).toBeDisabled();
  await page.getByLabel(/输入当前邮箱以确认/).fill('owner@example.test');
  await expect(deleteButton).toBeEnabled();
});

test('移动端更多菜单可用键盘关闭并恢复页面状态', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBusinessApi(page);
  await openAuthenticatedWorkspace(page);

  const moreButton = page.getByRole('button', { name: '打开更多功能' });
  await moreButton.click();
  await expect(moreButton).toHaveAttribute('aria-expanded', 'true');
  const drawer = page.getByRole('dialog', { name: '主导航菜单' });
  await expect(drawer).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(moreButton).toHaveAttribute('aria-expanded', 'false');
  await expect(moreButton).toBeFocused();
});
