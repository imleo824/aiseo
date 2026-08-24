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
  Cpu
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

  const navItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[] = [
    { 
      id: 'DASHBOARD', 
      label: '手动执行', 
      icon: <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
    },
    { 
      id: 'AUTOPILOT_TASKS', 
      label: '自动执行', 
      icon: <Bot className="w-4 h-4 text-emerald-500" />,
      badge: safeTasks.length > 0 ? `${activeTasksCount}` : undefined
    },
    { 
      id: 'KEYWORD_RADAR', 
      label: '我的词库', 
      icon: <Target className="w-4 h-4 text-rose-500" />,
      badge: 'HOT'
    },
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
    {
      id: 'CREDIT_LEDGER', 
      label: '我的账单', 
      icon: <Wallet className="w-4 h-4 text-amber-500" />,
      badge: account ? `${account.credits ?? 0}` : undefined
    },
  ];

  const adminNavItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[] = [
    { 
      id: 'SYSTEM_SERVICES_CONFIG', 
      label: '服务集成', 
      icon: <Cpu className="w-4 h-4 text-indigo-500" />,
      badge: 'PRO'
    },
    { 
      id: 'PRICING_CONFIG', 
      label: '付费配置', 
      icon: <Settings className="w-4 h-4 text-indigo-500" /> 
    },
    { 
      id: 'TENANT_MANAGEMENT', 
      label: '租户管理', 
      icon: <User className="w-4 h-4 text-blue-500" /> 
    },
    { 
      id: 'SYSTEM_PAYMENT_MANAGEMENT', 
      label: '付费管理', 
      icon: <Wallet className="w-4 h-4 text-emerald-500" /> 
    },
    { 
      id: 'SYSTEM_BILLING_MANAGEMENT', 
      label: '消耗管理', 
      icon: <Activity className="w-4 h-4 text-rose-500" /> 
    },
  ];

  const handleNavClick = (nav: NavItem) => {
    onSelectNav(nav);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  const navContent = (
    <div className="flex flex-col h-full bg-white text-slate-800 select-none justify-between">
      <div>
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900 tracking-tight">
                AI XEO
              </div>
              <div className="text-[11px] text-slate-500 font-normal">
                领先的全自动内容工具
              </div>
            </div>
          </div>

          {/* Mobile close button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition"
              aria-label="关闭菜单"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="px-3 py-3 space-y-1">
          {navItems.map(item => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  isActive 
                    ? 'bg-slate-900 text-white' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <span className="shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`px-1.5 py-0.5 text-[10px] rounded font-mono font-medium ${
                    isActive 
                      ? 'bg-slate-800 text-amber-300' 
                      : item.id === 'CREDIT_LEDGER'
                        ? 'bg-amber-50 text-amber-700 border border-amber-200/80'
                        : 'bg-slate-100 text-slate-600 border border-slate-200/60'
                  }`}>
                    {item.badge === 'HOT' ? '热门' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {account?.role === 'ADMIN' && (
            <div className="pt-3 mt-3 border-t border-slate-100">
              <div className="px-3 pb-1.5 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">系统管理</div>
              {adminNavItems.map(item => {
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      isActive 
                        ? 'bg-slate-900 text-white' 
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="shrink-0">{item.icon}</span>
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] rounded font-mono font-medium bg-amber-50 text-amber-700 border border-amber-200">
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
      <div className="p-3 border-t border-slate-200/80 bg-slate-50/50">
        <div className="p-2.5 bg-white rounded-md border border-slate-200 shadow-2xs space-y-2">
          {/* Tenant Profile info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-6 h-6 rounded flex items-center justify-center font-medium text-xs shrink-0 ${
                account?.role === 'ADMIN'
                  ? 'bg-amber-100 text-amber-700 border border-amber-200'
                  : 'bg-slate-100 text-slate-700 border border-slate-200'
              }`}>
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                  <span className="truncate">{account?.username || '未登录'}</span>
                  {account?.role === 'ADMIN' ? (
                    <span className="px-1 py-0.2 bg-amber-50 text-amber-700 text-[9px] font-medium rounded shrink-0 border border-amber-200">
                      管理员
                    </span>
                  ) : (
                    <span className="px-1 py-0.2 bg-slate-100 text-slate-600 text-[9px] font-medium rounded shrink-0 border border-slate-200">
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
