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
    growthStatuses,
    loading,
    actions
  } = useTenantData(activeTenantId, globalLanguage, (newTid) => {
    setActiveTenantId(newTid);
  });

  const getPageInfo = () => {
    switch (activeNav) {
      case 'DASHBOARD':
        return {
          title: '一键手动增长',
          desc: '输入关键词、参考文章或竞品站点，快速生成并发布优质 SEO 文章到您的站点'
        };
      case 'SITE_MANAGEMENT':
        return {
          title: '我的增长站点',
          desc: '绑定和管理您的网站，配置语言、发布设置与连接状态（首期已支持 WordPress）'
        };
      case 'AUTOPILOT_TASKS':
        return {
          title: '自动定时增长',
          desc: '配置自动巡航任务，让系统每天定时自动挖掘热词、撰写长文并自动推送到网站'
        };
      case 'AUDIT_LEDGER':
        return {
          title: '内容列表与审核',
          desc: '查看所有已生成文章的标题、内容、发布状态，支持一键下线或手动审核发布'
        };
      case 'CREDIT_LEDGER':
        return {
          title: '我的账单与积分',
          desc: '查看您的积分余额、充值记录以及全流程生成、发布的扣费明细'
        };
      case 'PRICING_CONFIG':
        return {
          title: '付费价格配置',
          desc: '管理系统各项 AI 操作 and 发布动作的积分扣费单价与套餐包'
        };
      case 'SYSTEM_SERVICES_CONFIG':
        return {
          title: '全局系统设置',
          desc: '配置发布确认模式、审查策略，and 查看底层大模型与第三方服务的集成状态'
        };
      case 'TENANT_MANAGEMENT':
        return {
          title: '租户与用户管理',
          desc: '管理多租户子账号的分配、角色权限和积分配额'
        };
      case 'SYSTEM_PAYMENT_MANAGEMENT':
        return {
          title: '充值订单核销',
          desc: '查看并核销租户通过 USDT 等方式提交的链上充值申请'
        };
      case 'SYSTEM_BILLING_MANAGEMENT':
        return {
          title: '全平台消耗审计',
          desc: '审计所有租户在生成、分析、检测等环节消耗的具体账单流水'
        };
      default:
        return {
          title: 'TuiTui 推推 (TT)',
          desc: '简单、高效的自动 SEO 流量增长系统（首期已支持 WordPress）'
        };
    }
  };

  const pageInfo = getPageInfo();

  if (loading && !account) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="text-center space-y-3 font-mono">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div className="text-xs text-slate-400 font-medium">正在同步租户与积分账户数据...</div>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50/80 p-6">
        <section className="bg-white border border-slate-200/90 rounded-2xl max-w-lg p-6 sm:p-8 space-y-4 shadow-2xs">
          <h1 className="text-xl font-bold text-slate-950">工作区暂时不可用</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            账号已登录，但真实业务数据加载失败。请确认 Supabase migration 已完成后重试。
          </p>
          <button
            className="btn-primary min-h-[44px] w-full"
            onClick={() => void actions.loadTenantData()}
          >
            重新加载
          </button>
        </section>
      </main>
    );
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
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between sticky top-0 z-30 shadow-2xs transition-all">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">

            {/* Mobile Hamburger Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-950 hover:bg-slate-100 rounded-xl transition cursor-pointer shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center active:scale-95"
              aria-label="打开导航菜单"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-2 sm:space-x-3 text-sm truncate">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100/90 rounded-xl text-slate-700 font-semibold border border-slate-200/90 shadow-2xs min-h-[38px]">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="truncate max-w-[150px]">{account?.username || '未登录'}</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline" />
              <span className="text-slate-950 font-bold text-sm sm:text-base lg:text-lg tracking-tight truncate">{pageInfo.title}</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
            {/* Quick Credit Balance Pill */}
            {account && (
              <div className="flex items-center gap-1 sm:gap-2 bg-slate-100/90 text-slate-800 border border-slate-200/90 px-2 sm:px-3 py-1 rounded-xl text-xs sm:text-sm font-medium shadow-2xs transition-all min-h-[38px]">
                <Coins className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span className="font-mono font-bold text-slate-950 text-xs sm:text-sm">{account.credits ?? 0}</span>
                <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">积分</span>
                <button
                  type="button"
                  onClick={() => setIsRechargeOpen(true)}
                  className="ml-0.5 sm:ml-1 px-2.5 py-1 bg-slate-950 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg transition cursor-pointer whitespace-nowrap active:scale-95 shadow-2xs min-h-[30px] flex items-center"
                >
                  充值
                </button>
              </div>
            )}

            {/* Global Language Selector */}
            <div className="flex items-center space-x-1.5 bg-slate-100/90 px-2.5 py-1.5 rounded-xl text-xs sm:text-sm border border-slate-200/90 shadow-2xs transition hover:bg-slate-200/70 min-h-[38px]">
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
              growthStatuses={growthStatuses}
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
              onOpenRecharge={() => setIsRechargeOpen(true)}
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
