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
  LogIn
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
  onOpenPricingConfig?: () => void;
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
  onOpenPricingConfig,
  onLogout
}) => {
  const safeSites = sites || [];
  const safeTasks = tasks || [];
  const activeTasksCount = safeTasks.filter(t => t.status === 'ACTIVE').length;

  const navItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[] = [
    { 
      id: 'DASHBOARD', 
      label: '一键执行', 
      icon: <Zap className="w-4 h-4 text-amber-500 fill-amber-500" />
    },
    { 
      id: 'AUTOPILOT_TASKS', 
      label: '自动执行', 
      icon: <Bot className="w-4 h-4 text-emerald-500" />,
      badge: safeTasks.length > 0 ? `${activeTasksCount}` : undefined
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
      id: 'PRICING_CONFIG', 
      label: '付费配置', 
      icon: <Settings className="w-4 h-4 text-indigo-500" /> 
    },
    {
      id: 'CREDIT_LEDGER', 
      label: '我的账单', 
      icon: <Wallet className="w-4 h-4 text-amber-500" />,
      badge: account ? `${account.credits ?? 0}` : undefined
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
            <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold text-sm text-slate-900 tracking-tight">
                SEO 自动发布
              </div>
              <div className="text-xs text-slate-400 font-sans">
                内容生成与收录系统
              </div>
            </div>
          </div>

          {/* Mobile close button */}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
              aria-label="关闭菜单"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <nav className="px-4 py-4 space-y-1.5 overflow-y-auto">
          {navItems.map(item => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                  isActive 
                    ? 'bg-slate-900 text-white shadow-sm' 
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <span className="shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                    isActive 
                      ? 'bg-amber-400 text-slate-950' 
                      : item.id === 'CREDIT_LEDGER'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tenant Account & Credit Quick Panel in Sidebar Footer */}
      <div className="p-4 border-t border-slate-100 bg-slate-50/70">
        <div className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-xs space-y-2.5">
          {/* Tenant Profile info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                account?.role === 'ADMIN'
                  ? 'bg-amber-500/15 text-amber-600'
                  : 'bg-emerald-500/15 text-emerald-600'
              }`}>
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5">
                  <span className="truncate">{account?.username || '未登录'}</span>
                  {account?.role === 'ADMIN' ? (
                    <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[9px] font-extrabold rounded-md shrink-0 border border-amber-200">
                      管理员
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 text-[9px] font-semibold rounded-md shrink-0 border border-emerald-200">
                      租户
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  {account?.companyName || (account?.role === 'ADMIN' ? '平台管理控制台' : account?.id || '独立租户空间')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {account ? (
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-2 py-1 text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-bold rounded-lg transition-colors border border-emerald-200 flex items-center gap-1"
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
