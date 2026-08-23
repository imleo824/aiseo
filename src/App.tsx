import { useState } from 'react';
import { NavItem, Language } from './types/seo';
import { Sidebar } from './components/Sidebar';
import { MainDashboard } from './components/MainDashboard';
import { ProAutopilotTasksTab } from './components/ProAutopilotTasksTab';
import { ProAuditLedgerTab } from './components/ProAuditLedgerTab';
import { ProSiteManagementTab } from './components/ProSiteManagementTab';
import { OnboardingModal } from './components/OnboardingModal';
import { RechargeModal } from './components/RechargeModal';
import { AuthModal } from './components/AuthModal';
import { ProPricingConfigTab } from './components/ProPricingConfigTab';
import { 
  Globe, 
  ChevronRight, 
  Menu, 
  Wallet, 
  ArrowDownLeft, 
  ArrowUpRight,
  Coins
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
    loading,
    actions
  } = useTenantData(activeTenantId, globalLanguage, (newTid) => {
    setActiveTenantId(newTid);
  });

  const getPageInfo = () => {
    switch (activeNav) {
      case 'DASHBOARD': 
        return { 
          title: '一键执行', 
          desc: '选站点并输入主题，一键自动生成与发布' 
        };
      case 'AUTOPILOT_TASKS': 
        return { 
          title: '自动执行', 
          desc: '定时任务规划、周期自动化发布与无人值守托管' 
        };
      case 'SITE_MANAGEMENT': 
        return { 
          title: '我的站点', 
          desc: 'WordPress 站点连接与管理' 
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
      default: 
        return { 
          title: 'SEO 自动发布', 
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
        onOpenPricingConfig={() => setActiveNav('PRICING_CONFIG')}
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
              <span className="text-slate-500 font-medium hidden xs:inline">SEO 自动化</span>
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
        <main className="flex-1 p-4 sm:p-6 lg:p-8 w-full max-w-6xl mx-auto">
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
            <div className="space-y-6 animate-fadeIn">
              {/* Top Credit Balance Card and Recharge Entry */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-500 shrink-0">
                    <Wallet className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-slate-400">当前账户可用积分</h3>
                    <div className="flex items-baseline gap-2.5 mt-1">
                      <span className="text-3xl font-black text-slate-900 font-mono">
                        {account?.credits?.toLocaleString() ?? 0}
                      </span>
                      <span className="text-xs font-bold text-slate-500">积分</span>
                      <span className="text-slate-200">|</span>
                      <span className="text-xs font-medium text-slate-400">
                        折合约 ${((account?.credits ?? 0) / 100).toFixed(2)} USDT
                      </span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => setIsRechargeOpen(true)}
                    className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-500/10 hover:shadow-amber-500/20 active:scale-95 transition-all flex items-center gap-2"
                  >
                    <Coins className="w-4 h-4 fill-slate-950 text-slate-950" />
                    <span>立即充值积分</span>
                  </button>
                </div>
              </div>

              {/* Transactions List */}
              <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-amber-500" />
                    <h3 className="font-bold text-slate-900 text-sm">积分变动明细流水</h3>
                  </div>
                  <span className="text-xs text-slate-400">共 {transactions.length} 条记录</span>
                </div>

                <div className="divide-y divide-slate-100">
                  {transactions.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-xs">
                      暂无积分明细记录，充值或执行任务后将在此展示流水
                    </div>
                  ) : (
                    transactions.map((tx) => {
                      const isRecharge = tx.type === 'RECHARGE';
                      return (
                        <div key={tx.id} className="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              isRecharge ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                            }`}>
                              {isRecharge ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-bold text-slate-900 truncate">{tx.description}</span>
                                {isRecharge ? (
                                  <span className="px-2 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 font-semibold rounded-full">
                                    充值入账
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-[10px] bg-slate-100 text-slate-700 font-semibold rounded-full">
                                    业务消费
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <span>{new Date(tx.createdAt).toLocaleString()}</span>
                                {tx.txHash && (
                                  <span className="font-mono text-slate-400 truncate max-w-xs">
                                    Hash: {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className={`text-sm font-black ${isRecharge ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {isRecharge ? `+${tx.amount}` : `-${tx.amount}`} 积分
                            </div>
                            <div className="text-[10px] text-slate-400">
                              余额: {tx.balance} 积分
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
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
