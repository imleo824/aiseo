import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MainDashboard } from './MainDashboard';

const connectedSite = {
  id: 'site-1',
  name: 'Customer WordPress',
  domain: 'example.com',
  niche: 'Software',
  siteType: 'WORDPRESS' as const,
  siteLanguage: 'zh-CN' as const,
  pagesCount: 12,
  connectorStatus: 'CONNECTED' as const,
  pluginInstalled: true,
  whitelistedCategories: [],
  gscConnected: false,
  ga4Connected: false,
  calibration: {
    isCalibrating: true,
    daysRemaining: 0,
    totalApprovedRequired: 3,
    approvedCount: 0,
    rejectedCount: 0,
    zeroFactErrorStreak: 0,
    autoPublishUnlocked: false
  },
  autopilotEnabled: false,
  createdAt: '2026-09-02T00:00:00.000Z'
};

describe('first-version execution dashboard contract', () => {
  it('keeps the original three-step layout while showing the five real worker stages', () => {
    const html = renderToStaticMarkup(<MainDashboard sites={[connectedSite]} drafts={[]} onStartGrowthProgram={async () => undefined} />);
    expect(html).toContain('选择站点');
    expect(html).toContain('选择主题');
    expect(html).toContain('开始执行');
    expect(html).toContain('了解网站');
    expect(html).toContain('发现机会');
    expect(html).toContain('选择动作');
    expect(html).toContain('执行与发布');
    expect(html).toContain('观察与学习');
    expect(html).not.toContain('8 阶段');
  });
});
