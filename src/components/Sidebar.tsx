import React from 'react';
import { WordPressSite, AutomatedTask, NavItem, TenantAccount } from '../types/seo';
import {
  Zap,
  Layers,
  Activity,
  Sparkles,
  Bot,
  X,
  Wallet,
  User,
  LogOut,
  Settings,
  LogIn,
  Target,
  Cpu,
  ShieldCheck
} from 'lucide-react';

interface SidebarProps {
  sites: WordPressSite[];
  tasks?: AutomatedTask[];
  activeNav: NavItem;
  onSelectNav: (nav: NavItem) => void;
  isOpenMobile?: boolean;
  onCloseMobile?: () => void;
  account?: TenantAccount | null;
  onOpenAuth?: () => void;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sites,
  tasks = [],
  activeNav,
  onSelectNav,
  isOpenMobile = false,
  onCloseMobile,
  account,
  onOpenAuth,
  onLogout
}) => {
  const safeSites = sites || [];
  const safeTasks = tasks || [];
  const activeTasksCount = safeTasks.filter(t => t.status === 'ACTIVE').length;

  const navGroups: {
    title: string;
    items: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[];
  }[] = [
    {
      title: '内容自动化',
      items: [
        {
          id: 'DASHBOARD',
          label: '手动执行',
          icon: <Zap className="w-4 h-4" />
        },
        {
          id: 'AUTOPILOT_TASKS',
          label: '自动执行',
          icon: <Bot className="w-4 h-4" />,
          badge: safeTasks.length > 0 ? `${activeTasksCount}` : undefined
        },
        {
          id: 'KEYWORD_RADAR',
          label: '我的词库',
          icon: <Target className="w-4 h-4" />
        },
      ]
    },
    {
      title: '资产与内容',
      items: [
        {
          id: 'SITE_MANAGEMENT',
          label: '我的站点',
          icon: <Layers className="w-4 h-4" />,
          badge: safeSites.length > 0 ? `${safeSites.length}` : undefined
        },
        {
          id: 'AUDIT_LEDGER',
          label: '我的内容',
          icon: <Activity className="w-4 h-4" />
        },
      ]
    },
    {
      title: '账户与账单',
      items: [
        {
          id: 'CREDIT_LEDGER',
          label: '我的账单',
          icon: <Wallet className="w-4 h-4" />
        },
      ]
    }
  ];

  const adminNavItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'PRICING_CONFIG',
      label: '付费配置',
      icon: <Settings className="w-4 h-4" />
    },
    {
      id: 'TENANT_MANAGEMENT',
      label: '租户管理',
      icon: <User className="w-4 h-4" />
    },
    {
      id: 'SYSTEM_PAYMENT_MANAGEMENT',
      label: '付费管理',
      icon: <Wallet className="w-4 h-4" />
    },
    {
      id: 'SYSTEM_BILLING_MANAGEMENT',
      label: '消耗管理',
      icon: <Activity className="w-4 h-4" />
    },
    {
      id: 'SYSTEM_SERVICES_CONFIG',
      label: '服务集成',
      icon: <Cpu className="w-4 h-4" />
    },
  ];

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
            <div className="w-8 h-8 rounded-xl bg-slate-950 text-white flex items-center justify-center font-bold text-sm shadow-xs ring-1 ring-slate-900/15">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-extrabold text-sm text-slate-950 tracking-tight flex items-center gap-1.5">
                <span>AI XEO</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">PRO</span>
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                全自动内容生产与发布系统
              </div>
            </div>
          </div>

          {/* Mobile close button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              aria-label="关闭菜单"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="px-3 py-3.5 space-y-4">
          {navGroups.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-1">
              <div className="px-3 pb-1.5 text-[10px] font-bold text-slate-400 tracking-wider uppercase">
                {group.title}
              </div>
              {group.items.map(item => {
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ${
                      isActive
                        ? 'bg-slate-950 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/90'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className={`shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-md font-mono font-bold ${
                        isActive
                          ? 'bg-slate-800 text-slate-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200/80'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {account?.role === 'ADMIN' && (
            <div className="pt-2.5 border-t border-slate-100 space-y-1">
              <div className="px-3 pb-1.5 text-[10px] font-bold text-indigo-500 tracking-wider uppercase">
                管理和配置
              </div>
              {adminNavItems.map(item => {
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ${
                      isActive
                        ? 'bg-slate-950 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/90'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="shrink-0">{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded-md font-mono font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
      </div>

      {/* Tenant Account & Credit Quick Panel in Sidebar Footer */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/50 shrink-0 space-y-3">
        {/* Tenant Profile info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-6 h-6 rounded flex items-center justify-center font-medium text-xs shrink-0 ${
              account?.role === 'ADMIN'
                ? 'bg-amber-100 text-amber-700 border border-amber-200/50'
                : 'bg-slate-100 text-slate-700 border border-slate-200/50'
            }`}>
              <User className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                <span className="truncate">{account?.username || '未登录'}</span>
                {account?.role === 'ADMIN' ? (
                  <span className="px-1 py-0.2 bg-amber-50 text-amber-700 text-[9px] font-medium rounded shrink-0 border border-amber-200/40">
                    管理员
                  </span>
                ) : (
                  <span className="px-1 py-0.2 bg-slate-100 text-slate-600 text-[9px] font-medium rounded shrink-0 border border-slate-200/40">
                    租户
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {account?.companyName || (account?.role === 'ADMIN' ? '管理控制台' : account?.id || '独立租户')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {account ? (
              <button
                type="button"
                onClick={onLogout}
                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors shrink-0"
                title="退出登录"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenAuth}
                className="px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 font-medium rounded transition-colors border border-slate-200 flex items-center gap-1"
              >
                <LogIn className="w-3 h-3" />
                <span>登录</span>
              </button>
            )}
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
            onClick={onCloseMobile}
          />

          {/* Drawer Panel */}
          <div className="relative w-4/5 max-w-xs bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200">
            {navContent}
          </div>
        </div>
      )}
    </>
  );
};
