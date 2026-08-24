import { useState } from 'react';
import { NavItem, Language } from './types/seo';
import { Sidebar } from './components/Sidebar';
import { MainDashboard } from './components/MainDashboard';
import { ProAutopilotTasksTab } from './components/ProAutopilotTasksTab';
import { ProAuditLedgerTab } from './components/ProAuditLedgerTab';
import { ProSiteManagementTab } from './components/ProSiteManagementTab';
import { ProCreditLedgerTab } from './components/ProCreditLedgerTab';
import { ProKeywordRadarTab } from './components/ProKeywordRadarTab';
import { OnboardingModal } from './components/OnboardingModal';
import { RechargeModal } from './components/RechargeModal';
import { AuthModal } from './components/AuthModal';
import { ProPricingConfigTab } from './components/ProPricingConfigTab';
import { ProTenantManagementTab } from './components/ProTenantManagementTab';
import { ProSystemPaymentTab } from './components/ProSystemPaymentTab';
import { ProSystemBillingTab } from './components/ProSystemBillingTab';
import { ProSystemServicesTab } from './components/ProSystemServicesTab';
import { 
  Globe, 
  ChevronRight, 
  Menu
} from 'lucide-react';
import { useTenantData } from './hooks/useTenantData';

export default function App() {
  const [activeTenantId, setActiveTenantId] = useState<string>('tenant-a');
  const [activeNav, setActiveNav] = useState<NavItem>('DASHBOARD');
  const [globalLanguage, setGlobalLanguage] = useState<Language>('zh-CN');
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Modals
    const [isAuthOpen, setIsAuthOpen] = useState(false);
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
          desc: '选站点并输入主题，手动生成与发布' 
        };
      case 'KEYWORD_RADAR':
        return {
          title: '我的词库',
          desc: 'KGR 黄金词算法、SERP 漏洞扫描与高 ROI 关键词智能挖掘'
        };
      case 'AUTOPILOT_TASKS': 
        return { 
          title: '自动执行', 
          desc: '定时任务规划、周期自动化发布与无人值守托管' 
        };
      case 'SITE_MANAGEMENT': 
        return { 
          title: '我的站点', 
          desc: '多 CMS 站点连接与发布管理' 
        };
      case 'AUDIT_LEDGER': 
        return { 
          title: '我的内容', 
          desc: '文章列表、收录状态与操作日志' 
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
      case 'TENANT_MANAGEMENT':
        return {
          title: '租户管理',
          desc: ''
        };
      case 'SYSTEM_PAYMENT_MANAGEMENT':
        return {
          title: '付费管理',
          desc: ''
        };
      case 'SYSTEM_BILLING_MANAGEMENT':
        return {
          title: '消耗管理',
          desc: ''
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

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 font-sans antialiased flex flex-col md:flex-row">
      
      {/* SIDEBAR (Desktop sticky + Mobile slide-over) */}
      <Sidebar
        sites={sites}
        tasks={tasks}
        activeNav={activeNav}
        onSelectNav={setActiveNav}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        account={account}
        onOpenAuth={() => setIsAuthOpen(true)}
        onLogout={actions.handleLogout}
      />

      {/* RIGHT WORKSPACE AREA */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto">
        
        {/* Workspace Top Header Bar */}
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 py-3 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
            
            {/* Mobile Hamburger Toggle Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-2 -ml-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition shrink-0"
              aria-label="打开导航菜单"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-mono truncate">
              <span className="text-slate-500 font-medium hidden xs:inline">AI XEO</span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden xs:inline" />
              <span className="text-slate-900 font-semibold truncate">{pageInfo.title}</span>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
            {/* Global Language Selector */}
            <div className="flex items-center space-x-1.5 bg-slate-100/90 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs border border-slate-200 font-mono shadow-2xs">
              <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={globalLanguage}
                onChange={(e) => setGlobalLanguage(e.target.value as Language)}
                className="bg-transparent text-slate-700 focus:outline-none cursor-pointer font-medium text-xs"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>
        </header>

        {/* Main Workspace Content Views */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 w-full max-w-[1920px] mx-auto">
          {activeNav === 'DASHBOARD' && (
            <MainDashboard
              sites={sites}
              drafts={drafts}
              onTriggerScan={actions.handleTriggerScan}
              onRollback={actions.handleRollback}
              onRunCruise={actions.handleRunCruise}
              onAnalyzeCompetitor={actions.handleAnalyzeCompetitorAttack}
            />
          )}

          {activeNav === 'KEYWORD_RADAR' && (
            <ProKeywordRadarTab
              sites={sites}
              onLaunchCruiseWithKeyword={async (keyword, siteId) => {
                setActiveNav('DASHBOARD');
                const targetSiteIds = siteId ? [siteId] : (sites.length > 0 ? [sites[0].id] : []);
                return await actions.handleRunCruise(
                  targetSiteIds,
                  (msg) => console.log(msg),
                  () => {},
                  keyword
                );
              }}
              onAddAutopilotTask={async (taskData) => {
                await actions.handleCreateTask(taskData);
                setActiveNav('AUTOPILOT_TASKS');
              }}
            />
          )}

          {activeNav === 'AUTOPILOT_TASKS' && (
            <ProAutopilotTasksTab
              sites={sites}
              tasks={tasks}
              onCreateTask={actions.handleCreateTask}
              onToggleTask={actions.handleToggleTask}
              onDeleteTask={actions.handleDeleteTask}
              onRunTaskNow={actions.handleRunTaskNow}
            />
          )}

          {activeNav === 'SITE_MANAGEMENT' && (
            <ProSiteManagementTab
              sites={sites}
              onUpdateSite={actions.handleUpdateSiteById}
              onDeleteSite={actions.handleDeleteSite}
              onTestSiteConnection={actions.handleTestSiteConnection}
              onOpenOnboarding={() => setIsOnboardingOpen(true)}
            />
          )}

          {activeNav === 'AUDIT_LEDGER' && (
            <ProAuditLedgerTab
              sites={sites}
              drafts={drafts}
              onRePushIndexing={async (draftId) => {
                await actions.handleApprovePublish(draftId);
              }}
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
              onSwitchTenant={(tid) => setActiveTenantId(tid)}
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
        </main>
      </div>

      {/* Onboarding Bind Modal */}
      {isOnboardingOpen && (
        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setIsOnboardingOpen(false)}
          onAddSite={async (siteData) => {
            await actions.handleAddSite(siteData);
            setIsOnboardingOpen(false);
          }}
        />
      )}

      

      {/* Auth Modal */}
      {(isAuthOpen || !account) && (
        <AuthModal
          isOpen={isAuthOpen || !account}
          onClose={() => setIsAuthOpen(false)}
          currentAccount={account}
          onLogin={actions.handleLogin}
          onRegister={actions.handleRegister}
          isMandatoryLogin={!account}
        />
      )}

      {/* Recharge/USDT Purchase Packages Modal */}
      {isRechargeOpen && (
        <RechargeModal
          isOpen={isRechargeOpen}
          onClose={() => setIsRechargeOpen(false)}
          account={account}
          onRechargeSuccess={actions.handleRechargeUsdt}
          tenantId={activeTenantId}
        />
      )}
    </div>
  );
}
