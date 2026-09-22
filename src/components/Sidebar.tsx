import React from 'react';
import { WordPressSite, NavItem, TenantAccount } from '../types/seo';
import {
  Zap,
  Layers,
  Activity,
  X,
  Wallet,
  User,
  LogOut,
  Settings,
  Cpu,
  Bot,
  Database
} from 'lucide-react';
import { useDialogInteraction } from '../hooks/useDialogInteraction';
import { ADMIN_NAV_ITEMS, CUSTOMER_NAV_GROUPS, NAVIGATION } from '../navigation';

interface SidebarProps {
  sites: WordPressSite[];
  activeNav: NavItem;
  onSelectNav: (nav: NavItem) => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  account: TenantAccount;
  onLogout: () => void;
}

const NAV_ICONS: Record<NavItem, React.ReactNode> = {
  DASHBOARD: <Zap className="w-4 h-4" />,
  AUTOPILOT_TASKS: <Bot className="w-4 h-4" />,
  SITE_MANAGEMENT: <Layers className="w-4 h-4" />,
  AUDIT_LEDGER: <Activity className="w-4 h-4" />,
  CREDIT_LEDGER: <Wallet className="w-4 h-4" />,
  ACCOUNT_DATA: <Database className="w-4 h-4" />,
  PRICING_CONFIG: <Settings className="w-4 h-4" />,
  TENANT_MANAGEMENT: <User className="w-4 h-4" />,
  SYSTEM_PAYMENT_MANAGEMENT: <Wallet className="w-4 h-4" />,
  SYSTEM_BILLING_MANAGEMENT: <Activity className="w-4 h-4" />,
  SYSTEM_SERVICES_CONFIG: <Cpu className="w-4 h-4" />
};

export const Sidebar: React.FC<SidebarProps> = ({
  sites,
  activeNav,
  onSelectNav,
  isOpenMobile = false,
  onCloseMobile,
  account,
  onLogout
}) => {
  const { dialogRef: mobileDialogRef, onBackdropMouseDown } = useDialogInteraction({
    open: isOpenMobile,
    onClose: onCloseMobile || (() => undefined)
  });

  const handleNavClick = (nav: NavItem) => {
    onSelectNav(nav);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const navContent = (
    <div className="flex flex-col h-full bg-white text-slate-800 select-none">
      {/* Scrollable Navigation Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-sm z-10">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-slate-950 text-white flex items-center justify-center font-black text-xs shadow-xs ring-1 ring-slate-900/15">
              <span className="font-mono tracking-tighter text-emerald-400">TT</span>
            </div>
            <div>
              <div className="font-extrabold text-sm text-slate-950 tracking-tight flex items-center gap-1.5">
                <span>TuiTui 推推</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">PRO</span>
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                自动 SEO 流量增长系统
              </div>
            </div>
          </div>

          {/* Mobile close button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="关闭菜单"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="px-3 py-3.5 space-y-4">
          {CUSTOMER_NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                {group.title}
              </div>
              {group.items.map((id) => {
                const isActive = activeNav === id;
                const badge = id === 'SITE_MANAGEMENT' && sites.length > 0 ? `${sites.length}` : undefined;
                return (
                  <button
                    key={id}
                    onClick={() => handleNavClick(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between px-3 py-2 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-150 cursor-pointer min-h-[44px] sm:min-h-[38px] ${
                      isActive
                        ? 'bg-slate-950 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/90'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>{NAV_ICONS[id]}</span>
                      <span>{NAVIGATION[id].label}</span>
                    </div>
                    {badge && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-md font-mono font-bold ${
                        isActive
                          ? 'bg-slate-800 text-slate-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200/80'
                      }`}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {account.role === 'ADMIN' && (
            <div className="pt-2.5 border-t border-slate-100 space-y-1">
              <div className="px-3 pb-1 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                管理与配置
              </div>
              {ADMIN_NAV_ITEMS.map((id) => {
                const isActive = activeNav === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleNavClick(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between px-3 py-2 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-150 cursor-pointer min-h-[44px] sm:min-h-[38px] ${
                      isActive
                        ? 'bg-slate-950 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/90'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="shrink-0">{NAV_ICONS[id]}</span>
                      <span>{NAVIGATION[id].label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      </div>

      {/* Tenant account footer */}
      <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50/60 shrink-0 space-y-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {/* Tenant Profile info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-medium text-xs shrink-0 ${
              account.role === 'ADMIN'
                ? 'bg-amber-100 text-amber-700 border border-amber-200/50'
                : 'bg-slate-200 text-slate-700 border border-slate-300/50'
            }`}>
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                <span className="truncate">{account.username}</span>
                {account.role === 'ADMIN' ? (
                  <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[9px] font-semibold rounded shrink-0 border border-amber-200/50">
                    管理员
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-semibold rounded shrink-0 border border-slate-200/50">
                    客户
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 truncate mt-0.5">
                {account.companyName || (account.role === 'ADMIN' ? '管理控制台' : account.id)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onLogout}
              aria-label="退出登录"
              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center"
              title="退出登录"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col h-screen sticky top-0 border-r border-slate-200/80 z-20">
        {navContent}
      </aside>

      {/* Mobile Slide-over Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onMouseDown={onBackdropMouseDown}
          />

          {/* Drawer Panel */}
          <div ref={mobileDialogRef} role="dialog" aria-modal="true" aria-label="主导航菜单" tabIndex={-1} className="relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
