import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavItem, Language } from './types/seo';
import { Sidebar } from './components/Sidebar';
import { MainDashboard } from './components/MainDashboard';
import { OnboardingModal } from './components/OnboardingModal';
import { RechargeModal } from './components/RechargeModal';
import { MobileBottomNav } from './components/MobileBottomNav';
import {
  ChevronRight,
  Menu
} from 'lucide-react';
import { useTenantData } from './hooks/useTenantData';
import { ApiService } from './services/api';
import { isAdminNavItem, NAVIGATION, navFromSearch, requiresWorkspaceResource } from './navigation';

const ProAuditLedgerTab = lazy(() => import('./components/ProAuditLedgerTab').then(({ ProAuditLedgerTab }) => ({ default: ProAuditLedgerTab })));
const ProAutopilotTasksTab = lazy(() => import('./components/ProAutopilotTasksTab').then(({ ProAutopilotTasksTab }) => ({ default: ProAutopilotTasksTab })));
const ProSiteManagementTab = lazy(() => import('./components/ProSiteManagementTab').then(({ ProSiteManagementTab }) => ({ default: ProSiteManagementTab })));
const ProCreditLedgerTab = lazy(() => import('./components/ProCreditLedgerTab').then(({ ProCreditLedgerTab }) => ({ default: ProCreditLedgerTab })));
const ProPricingConfigTab = lazy(() => import('./components/ProPricingConfigTab').then(({ ProPricingConfigTab }) => ({ default: ProPricingConfigTab })));
const ProTenantManagementTab = lazy(() => import('./components/ProTenantManagementTab').then(({ ProTenantManagementTab }) => ({ default: ProTenantManagementTab })));
const ProSystemPaymentTab = lazy(() => import('./components/ProSystemPaymentTab').then(({ ProSystemPaymentTab }) => ({ default: ProSystemPaymentTab })));
const ProSystemBillingTab = lazy(() => import('./components/ProSystemBillingTab').then(({ ProSystemBillingTab }) => ({ default: ProSystemBillingTab })));
const ProSystemServicesTab = lazy(() => import('./components/ProSystemServicesTab').then(({ ProSystemServicesTab }) => ({ default: ProSystemServicesTab })));
const AccountDataTab = lazy(() => import('./components/AccountDataTab').then(({ AccountDataTab }) => ({ default: AccountDataTab })));

const navFromLocation = (): NavItem => {
  if (typeof window === 'undefined') return 'DASHBOARD';
  return navFromSearch(window.location.search);
};

const getDefaultLanguage = (): Language => {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('en')) return 'en-US';
  }
  return 'zh-CN';
};

export default function WorkspaceApp() {
  const [activeTenantId, setActiveTenantId] = useState<string>('');
  const [activeNav, setActiveNav] = useState<NavItem>(navFromLocation);
  const [defaultLanguage] = useState<Language>(getDefaultLanguage);
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
    refreshing,
    loadError,
    actions
  } = useTenantData(activeTenantId, activeNav, (newTid) => {
    setActiveTenantId(newTid);
  });

  const rechargePricing = useQuery({
    queryKey: ['recharge-pricing', activeTenantId],
    queryFn: () => new ApiService(activeTenantId).getCreditConfig(),
    enabled: Boolean((isRechargeOpen || requiresWorkspaceResource(activeNav, 'pricing')) && account && activeTenantId),
    staleTime: 5 * 60_000,
    retry: 1
  });

  const navigateTo = useCallback((nextNav: NavItem, replace = false) => {
    setActiveNav(nextNav);
    setIsMobileMenuOpen(false);
    const url = new URL(window.location.href);
    if (nextNav === 'DASHBOARD') url.searchParams.delete('view');
    else url.searchParams.set('view', nextNav);
    window.history[replace ? 'replaceState' : 'pushState']({ view: nextNav }, '', url);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setActiveNav(navFromLocation());
      setIsMobileMenuOpen(false);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (account && account.role !== 'ADMIN' && isAdminNavItem(activeNav)) navigateTo('DASHBOARD', true);
  }, [account?.role, activeNav, navigateTo]);
  const pageInfo = NAVIGATION[activeNav];

  if (loading && !account) {
    return (
      <main className="min-h-[100dvh] bg-slate-50/80 grid place-items-center p-6" aria-busy="true">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-950 rounded-full animate-spin mx-auto" />
          <div className="mt-3 text-sm text-slate-600 font-medium">正在加载工作区…</div>
          <div className="mt-1 text-xs text-slate-400">正在恢复您的数据</div>
        </div>
      </main>
    );
  }

  if (loadError && !loading && !account) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50/80 p-6">
        <section className="bg-white border border-slate-200/90 rounded-2xl max-w-lg p-6 sm:p-8 space-y-4 shadow-2xs" role="alert">
          <h1 className="text-xl font-bold text-slate-950">业务数据暂时无法加载</h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            {loadError instanceof Error ? loadError.message : '服务器未返回可用数据。请稍后重试。'}
          </p>
          <button className="btn-primary min-h-[44px] w-full" onClick={() => void actions.loadTenantData()}>
            重新加载
          </button>
        </section>
      </main>
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
        activeNav={activeNav}
        onSelectNav={navigateTo}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        account={account}
        onLogout={actions.handleLogout}
      />

      {/* RIGHT WORKSPACE AREA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-[100dvh]">

        {/* Workspace Top Header Bar */}
        <header className="relative bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between sticky top-0 z-30 shadow-2xs transition-all">
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

          {refreshing && (
            <div role="status" aria-live="polite" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-slate-100">
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-emerald-500" />
              <span className="sr-only">正在同步最新数据</span>
            </div>
          )}
        </header>

        {/* Main Workspace Content Views */}
        <main className="flex-1 p-3 sm:p-5 lg:p-8 pb-24 md:pb-10 w-full max-w-7xl mx-auto">
          {loadError && (
            <div role="alert" className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="font-bold">部分最新数据暂时未同步。</strong>
                <span className="ml-1 text-amber-800">页面已保留上一次可用内容，可以继续查看。</span>
              </div>
              <button type="button" onClick={() => void actions.loadTenantData()} className="min-h-[38px] shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-800">
                立即重试
              </button>
            </div>
          )}
          <Suspense fallback={(
            <div aria-busy="true" className="space-y-4 py-2">
              <div className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
              <div className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            </div>
          )}>
          {activeNav === 'DASHBOARD' && (
            <MainDashboard
              key={activeTenantId || account.id}
              sites={sites}
              drafts={drafts}
              growthStatuses={growthStatuses}
              workspaceId={activeTenantId || account.id}
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
              onOpenSiteManagement={() => navigateTo('SITE_MANAGEMENT')}
            />
          )}

          {activeNav === 'AUDIT_LEDGER' && (
            <ProAuditLedgerTab
              sites={sites}
              drafts={drafts}
              onApprovePublish={actions.handleApprovePublish}
              onRejectDraft={actions.handleRejectDraft}
              onRetryPublish={actions.handleRetryPublish}
              onStartGrowth={() => navigateTo('DASHBOARD')}
            />
          )}

          {activeNav === 'CREDIT_LEDGER' && (
            <ProCreditLedgerTab
              account={account}
              transactions={transactions}
              pricing={rechargePricing.data}
              pricingLoading={rechargePricing.isLoading}
              pricingError={rechargePricing.isError}
              onOpenRecharge={() => setIsRechargeOpen(true)}
            />
          )}

          {activeNav === 'ACCOUNT_DATA' && (
            <AccountDataTab account={account} tenantId={activeTenantId} />
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
        onSelectNav={navigateTo}
        onOpenMobileDrawer={() => setIsMobileMenuOpen(true)}
        isDrawerOpen={isMobileMenuOpen}
        sites={sites}
        account={account}
      />

      {/* Onboarding Bind Modal */}
      {isOnboardingOpen && (
        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          onAddSite={actions.handleAddSite}
          onAuthorizeWordPress={actions.handleAuthorizeWordPress}
          defaultLanguage={defaultLanguage}
        />
      )}

      {/* Recharge/USDT Purchase Packages Modal */}
      {isRechargeOpen && (
        <RechargeModal
          isOpen={isRechargeOpen}
          onClose={() => setIsRechargeOpen(false)}
          account={account}
          tenantId={activeTenantId}
          initialConfig={rechargePricing.data}
        />
      )}
    </div>
  );
}
