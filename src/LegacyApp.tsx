import { lazy, Suspense, useState } from 'react';
import { NavItem, Language } from './types/seo';
import { Sidebar } from './components/Sidebar';
import { MainDashboard } from './components/MainDashboard';
import { OnboardingModal } from './components/OnboardingModal';
import { RechargeModal } from './components/RechargeModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import {
  Globe,
  ChevronRight,
  Menu,
  Coins
} from 'lucide-react';
import { useTenantData } from './hooks/useTenantData';

const ProAuditLedgerTab = lazy(() => import('./components/ProAuditLedgerTab').then(({ ProAuditLedgerTab }) => ({ default: ProAuditLedgerTab })));
const ProAutopilotTasksTab = lazy(() => import('./components/ProAutopilotTasksTab').then(({ ProAutopilotTasksTab }) => ({ default: ProAutopilotTasksTab })));
const ProSiteManagementTab = lazy(() => import('./components/ProSiteManagementTab').then(({ ProSiteManagementTab }) => ({ default: ProSiteManagementTab })));
const ProCreditLedgerTab = lazy(() => import('./components/ProCreditLedgerTab').then(({ ProCreditLedgerTab }) => ({ default: ProCreditLedgerTab })));
const ProPricingConfigTab = lazy(() => import('./components/ProPricingConfigTab').then(({ ProPricingConfigTab }) => ({ default: ProPricingConfigTab })));
const ProTenantManagementTab = lazy(() => import('./components/ProTenantManagementTab').then(({ ProTenantManagementTab }) => ({ default: ProTenantManagementTab })));
const ProSystemPaymentTab = lazy(() => import('./components/ProSystemPaymentTab').then(({ ProSystemPaymentTab }) => ({ default: ProSystemPaymentTab })));
const ProSystemBillingTab = lazy(() => import('./components/ProSystemBillingTab').then(({ ProSystemBillingTab }) => ({ default: ProSystemBillingTab })));
const ProSystemServicesTab = lazy(() => import('./components/ProSystemServicesTab').then(({ ProSystemServicesTab }) => ({ default: ProSystemServicesTab })));

const getDefaultLanguage = (): Language => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
  }
  return 'zh-CN';
};

export default function LegacyApp() {
  const [activeTenantId, setActiveTenantId] = useState<string>('');
  const [activeNav, setActiveNav] = useState<NavItem>('DASHBOARD');
  const [globalLanguage, setGlobalLanguage] = useState<Language>(getDefaultLanguage());
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Modals
  const [isRechargeOpen, setIsRechargeOpen] = useState(false);

  const {
    sites,
    tasks,
    drafts,
    account,
    transactions,
    allTenants,
    loading,
    actions
  } = useTenantData(activeTenantId, globalLanguage, (newTid) => {
    setActiveTenantId(newTid);
  });

  const getPageInfo = () => {
    switch (activeNav) {
      case 'DASHBOARD':
        return {
          title: '手动执行',
          desc: '选择站点与目标，剩余流程由系统自动完成'
        };
      case 'SITE_MANAGEMENT':
        return {
          title: '我的站点',
          desc: 'WordPress 官方授权、可选 GSC 与发布策略管理'
        };
      case 'AUTOPILOT_TASKS':
        return { title: '自动执行', desc: '同一条增长链路按真实新证据自动选择、执行和观察' };
      case 'AUDIT_LEDGER':
        return {
          title: '我的内容',
          desc: '交付内容、发布状态与真实观察记录'
        };
      case 'CREDIT_LEDGER':
        return {
          title: '我的账单',
          desc: '积分余额与全链路消费明细'
        };
      case 'PRICING_CONFIG':
        return {
          title: '付费配置',
          desc: '系统扣费单价、汇率与充值套餐包可视化管理'
        };
      case 'SYSTEM_SERVICES_CONFIG':
        return {
          title: '服务集成',
          desc: '配置 AI 大模型、SERP 搜索引擎与第三方服务集成'
        };
      case 'TENANT_MANAGEMENT':
        return {
          title: '租户管理',
          desc: '多租户账号、角色权限与积分配额全局调配'
        };
      case 'SYSTEM_PAYMENT_MANAGEMENT':
        return {
          title: '付费管理',
          desc: 'USDT 充值订单与链上交易哈希核销对账'
        };
      case 'SYSTEM_BILLING_MANAGEMENT':
        return {
          title: '消耗管理',
          desc: '全平台各项 AI 操作扣费与流水明细审计'
        };
      default:
        return {
          title: 'AI XEO',
          desc: '内容自动化系统'
        };
    }
  };

  const pageInfo = getPageInfo();

  if (loading && !account) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3 font-mono">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div className="text-xs text-slate-400">正在同步租户与积分账户数据...</div>
        </div>
      </div>
    );
  }

  if (!account) {
    return <main className="min-h-screen grid place-items-center bg-slate-50 p-6"><section className="app-card max-w-lg p-6 space-y-4"><h1 className="text-xl font-bold text-slate-950">工作区暂时不可用</h1><p className="text-sm text-slate-600">账号已登录，但真实业务数据加载失败。请确认 Supabase migration 已完成后重试。</p><button className="btn-primary" onClick={() => void actions.loadTenantData()}>重新加载</button></section></main>;
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50/70 text-slate-900 font-sans antialiased flex flex-col md:flex-row">

      {/* SIDEBAR (Desktop sticky + Mobile slide-over) */}
      <Sidebar
        sites={sites}
        tasks={tasks}
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        account={account}
        onLogout={actions.handleLogout}
      />

      {/* RIGHT WORKSPACE AREA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[100dvh]">

        {/* Workspace Top Header Bar */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-2xs transition-all">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">

            {/* Mobile Hamburger Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition cursor-pointer shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
              aria-label="打开导航菜单"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2 sm:space-x-3 text-sm truncate">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-slate-700 font-medium border border-slate-200/80 shadow-xs">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span>
                <span className="truncate max-w-[150px]">{account?.username || '未登录'}</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline" />
              <span className="text-slate-950 font-bold text-sm sm:text-base lg:text-lg tracking-tight truncate">{pageInfo.title}</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-3 shrink-0">
            {/* Quick Credit Balance Pill */}
            {account && (
              <div className="flex items-center gap-1 sm:gap-2 bg-slate-100/90 text-slate-800 border border-slate-200/90 px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl text-xs sm:text-sm font-medium shadow-2xs transition-all">
                <Coins className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span className="font-mono font-bold text-slate-950 text-xs sm:text-sm">{account.credits ?? 0}</span>
                <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">积分</span>
                <button
                  type="button"
                  onClick={() => setIsRechargeOpen(true)}
                  className="ml-0.5 sm:ml-1 px-2 sm:px-2.5 py-1 sm:py-0.5 bg-slate-950 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer whitespace-nowrap active:scale-95 shadow-2xs min-h-[28px] flex items-center"
                >
                  充值
                </button>
              </div>
            )}

            {/* Global Language Selector */}
            <div className="flex items-center space-x-1 bg-slate-100/90 px-2 sm:px-2.5 py-1.5 rounded-xl text-xs sm:text-sm border border-slate-200 shadow-2xs transition hover:bg-slate-200/70 min-h-[32px]">
              <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={globalLanguage}
                onChange={(e) => setGlobalLanguage(e.target.value as Language)}
                className="bg-transparent text-slate-800 focus:outline-none cursor-pointer font-semibold text-xs sm:text-sm"
              >
                <option value="zh-CN">CH</option>
                <option value="en-US">En</option>
              </select>
            </div>
          </div>
        </header>

        {/* Main Workspace Content Views */}
        <main className="flex-1 p-3 sm:p-5 lg:p-8 pb-24 md:pb-10 w-full max-w-7xl mx-auto">
          <Suspense fallback={<div className="py-16 text-center text-sm text-slate-500">正在加载工作区…</div>}>
          {activeNav === 'DASHBOARD' && (
            <MainDashboard
              sites={sites}
              drafts={drafts}
              onRollback={actions.handleRollback}
              onStartGrowthProgram={actions.handleStartGrowthProgram}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
            />
          )}

          {activeNav === 'SITE_MANAGEMENT' && (
            <ProSiteManagementTab
              sites={sites}
              onUpdateSite={actions.handleUpdateSiteById}
              onDeleteSite={actions.handleDeleteSite}
              onTestSiteConnection={actions.handleTestSiteConnection}
              onAuthorizeWordPress={actions.handleAuthorizeWordPress}
              onSetAutopilot={actions.handleSetAutopilot}
              onRefreshSites={actions.loadTenantData}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
            />
          )}

          {activeNav === 'AUTOPILOT_TASKS' && (
            <ProAutopilotTasksTab
              sites={sites}
              tasks={tasks}
              onCreateTask={actions.handleCreateTask}
              onToggleTask={actions.handleToggleTask}
              onRunTaskNow={actions.handleRunTaskNow}
            />
          )}

          {activeNav === 'AUDIT_LEDGER' && (
            <ProAuditLedgerTab
              sites={sites}
              drafts={drafts}
              onApprovePublish={actions.handleApprovePublish}
            />
          )}

          {activeNav === 'CREDIT_LEDGER' && (
            <ProCreditLedgerTab
              account={account}
              transactions={transactions}
              tenantId={activeTenantId}
            />
          )}

          {activeNav === 'SYSTEM_SERVICES_CONFIG' && (
            <ProSystemServicesTab
              tenantId={activeTenantId}
            />
          )}

          {activeNav === 'PRICING_CONFIG' && (
            <ProPricingConfigTab
              account={account}
              tenantId={activeTenantId}
              onConfigSaved={() => {
                actions.loadTenantData();
              }}
            />
          )}

          {activeNav === 'TENANT_MANAGEMENT' && (
            <ProTenantManagementTab
              account={account}
              allTenants={allTenants}
              activeTenantId={activeTenantId}
              onRefreshData={() => actions.loadTenantData()}
            />
          )}
          {activeNav === 'SYSTEM_PAYMENT_MANAGEMENT' && (
            <ProSystemPaymentTab
              account={account}
              activeTenantId={activeTenantId}
            />
          )}
          {activeNav === 'SYSTEM_BILLING_MANAGEMENT' && (
            <ProSystemBillingTab
              account={account}
              activeTenantId={activeTenantId}
            />
          )}
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Visible on mobile screens) */}
      <MobileBottomNav
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        onOpenMobileDrawer={() => setIsMobileMenuOpen(true)}
        sites={sites}
        tasks={tasks}
        account={account}
      />

      {/* Onboarding Bind Modal */}
      {isOnboardingOpen && (
        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          onAddSite={actions.handleAddSite}
          onAuthorizeWordPress={actions.handleAuthorizeWordPress}
        />
      )}

      {/* Recharge/USDT Purchase Packages Modal */}
      {isRechargeOpen && (
        <RechargeModal
          isOpen={isRechargeOpen}
          onClose={() => setIsRechargeOpen(false)}
          account={account}
          tenantId={activeTenantId}
        />
      )}
    </div>
  );
}
