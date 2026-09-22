import React from 'react';
import { NavItem, WordPressSite, TenantAccount } from '../types/seo';
import {
  Zap,
  Layers,
  Activity,
  Menu
} from 'lucide-react';
import { MOBILE_PRIMARY_NAV_ITEMS, NAVIGATION } from '../navigation';

interface MobileBottomNavProps {
  activeNav: NavItem;
  onSelectNav: (nav: NavItem) => void;
  onOpenMobileDrawer: () => void;
  isDrawerOpen?: boolean;
  sites: WordPressSite[];
  account: TenantAccount;
}

const MOBILE_ICONS: Record<(typeof MOBILE_PRIMARY_NAV_ITEMS)[number], React.ReactNode> = {
  DASHBOARD: <Zap className="w-5 h-5" />,
  SITE_MANAGEMENT: <Layers className="w-5 h-5" />,
  AUDIT_LEDGER: <Activity className="w-5 h-5" />
};

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeNav,
  onSelectNav,
  onOpenMobileDrawer,
  isDrawerOpen = false,
  sites,
  account
}) => {
  const isOtherActive = !(MOBILE_PRIMARY_NAV_ITEMS as readonly NavItem[]).includes(activeNav);

  return (
    <nav
      aria-label="移动端底部快速导航"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] px-1.5 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {MOBILE_PRIMARY_NAV_ITEMS.map((id) => {
          const isActive = activeNav === id;
          const badge = id === 'SITE_MANAGEMENT' && sites.length > 0 ? `${sites.length}` : undefined;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectNav(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative cursor-pointer min-h-[50px] active:scale-95 ${
                isActive
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className={`relative p-1.5 rounded-xl transition-all ${
                isActive ? 'bg-slate-900 text-white shadow-xs scale-105' : 'text-slate-600'
              }`}>
                {MOBILE_ICONS[id]}
                {badge && (
                  <span className="absolute -top-1 -right-1 px-1 min-w-[15px] h-[15px] text-[9px] font-mono font-bold bg-amber-500 text-white rounded-full flex items-center justify-center border-2 border-white shadow-xs">
                    {badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] tracking-tight mt-0.5 whitespace-nowrap ${
                isActive ? 'font-bold text-slate-950 scale-105' : 'font-medium text-slate-500'
              }`}>
                {NAVIGATION[id].label}
              </span>
            </button>
          );
        })}

        {/* More Menu Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-haspopup="dialog"
          aria-expanded={isDrawerOpen}
          aria-label="打开更多功能"
          className={`flex-1 flex flex-col items-center justify-center py-1 px-0.5 rounded-xl transition-all duration-150 relative cursor-pointer min-h-[50px] active:scale-95 ${
            isOtherActive
              ? 'text-slate-950 font-bold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className={`p-1.5 rounded-xl transition-all ${
            isOtherActive ? 'bg-slate-900 text-white shadow-xs scale-105' : 'text-slate-600'
          }`}>
            <Menu className="w-5 h-5" />
          </div>
          <span className={`text-[10px] tracking-tight mt-0.5 whitespace-nowrap ${
            isOtherActive ? 'font-bold text-slate-950' : 'font-medium text-slate-500'
          }`}>
            {isOtherActive ? (account.role === 'ADMIN' ? '管理' : '账单') : '更多'}
          </span>
        </button>
      </div>
    </nav>
  );
};
