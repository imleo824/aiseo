import React from 'react';
import { NavItem, WordPressSite, AutomatedTask, TenantAccount } from '../types/seo';
import {
  Zap,
  Bot,
  Target,
  Layers,
  Activity,
  Menu
} from 'lucide-react';

interface MobileBottomNavProps {
  activeNav: NavItem;
  onSelectNav: (nav: NavItem) => void;
  onOpenMobileDrawer: () => void;
  sites?: WordPressSite[];
  tasks?: AutomatedTask[];
  account?: TenantAccount | null;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeNav,
  onSelectNav,
  onOpenMobileDrawer,
  sites = [],
  tasks = [],
  account
}) => {
  const safeSites = sites || [];
  const safeTasks = tasks || [];
  const activeTasksCount = safeTasks.filter(t => t.status === 'ACTIVE').length;

  const mainNavItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: string }[] = [
    {
      id: 'DASHBOARD',
      label: '手动执行',
      icon: <Zap className="w-5 h-5" />,
    },
    {
      id: 'AUTOPILOT_TASKS',
      label: '自动执行',
      icon: <Bot className="w-5 h-5" />,
      badge: activeTasksCount > 0 ? `${activeTasksCount}` : undefined
    },
    {
      id: 'KEYWORD_RADAR',
      label: '我的词库',
      icon: <Target className="w-5 h-5" />,
    },
    {
      id: 'SITE_MANAGEMENT',
      label: '我的站点',
      icon: <Layers className="w-5 h-5" />,
      badge: safeSites.length > 0 ? `${safeSites.length}` : undefined
    },
    {
      id: 'AUDIT_LEDGER',
      label: '我的内容',
      icon: <Activity className="w-5 h-5" />,
    },
  ];

  const isOtherActive = !mainNavItems.some(item => item.id === activeNav);

  return (
    <nav
      aria-label="移动端底部快速导航"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] px-1.5 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {mainNavItems.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectNav(item.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative cursor-pointer min-h-[50px] active:scale-95 ${
                isActive
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className={`relative p-1.5 rounded-xl transition-all ${
                isActive ? 'bg-slate-900 text-white shadow-xs scale-105' : 'text-slate-600'
              }`}>
                {item.icon}
                {item.badge && (
                  <span className="absolute -top-1 -right-1 px-1 min-w-[15px] h-[15px] text-[9px] font-mono font-bold bg-amber-500 text-white rounded-full flex items-center justify-center border-2 border-white shadow-xs">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] tracking-tight mt-0.5 whitespace-nowrap ${
                isActive ? 'font-bold text-slate-950 scale-105' : 'font-medium text-slate-500'
              }`}>
                {item.label}
              </span>
            </button>
          );
        })}

        {/* More Menu Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          className={`flex-1 flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative cursor-pointer min-h-[50px] active:scale-95 ${
            isOtherActive
              ? 'text-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1.5 rounded-xl transition-all ${
            isOtherActive ? 'bg-indigo-600 text-white shadow-xs scale-105' : 'text-slate-600'
          }`}>
            <Menu className="w-5 h-5" />
          </div>
          <span className={`text-[10px] tracking-tight mt-0.5 whitespace-nowrap ${
            isOtherActive ? 'font-bold text-indigo-600' : 'font-medium text-slate-500'
          }`}>
            {isOtherActive ? (account?.role === 'ADMIN' ? '管理' : '账单') : '更多'}
          </span>
        </button>
      </div>
    </nav>
  );
};
