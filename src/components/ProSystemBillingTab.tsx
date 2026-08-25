import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Search, RefreshCw, Layers, ArrowDownRight } from 'lucide-react';
import { TenantAccount } from '../types/seo';
import { createApiService } from '../services/api';

interface UsageRecord {
  id: string;
  tenantId: string;
  siteId?: string;
  taskId?: string;
  action: string;
  actionName: string;
  creditsDeducted: number;
  remainingCredits: number;
  createdAt: string;
  description?: string;
}

interface ProSystemBillingTabProps {
  account?: TenantAccount | null;
  activeTenantId?: string;
}

export const ProSystemBillingTab: React.FC<ProSystemBillingTabProps> = ({
  account,
  activeTenantId = 'tenant-a'
}) => {
  const [usages, setUsages] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchUsages = async () => {
    setLoading(true);
    try {
      const api = createApiService(activeTenantId);
      let res;
      if (account?.role === 'ADMIN') {
        res = await api.getAllUsages();
      } else {
        // Tenant view fallback
        const txRes = await api.getCreditTransactions();
        if (txRes.success && txRes.transactions) {
          const consumeTxs = txRes.transactions.filter(t => t.type === 'CONSUME' || t.amount < 0);
          res = {
            success: true,
            usages: consumeTxs.map(t => ({
              id: t.id,
              tenantId: t.tenantId,
              siteId: t.metadata?.siteId,
              taskId: t.metadata?.taskId,
              action: t.action,
              actionName: t.description || t.action,
              creditsDeducted: Math.abs(t.amount),
              remainingCredits: t.balance,
              createdAt: t.createdAt,
              description: t.description
            }))
          };
        }
      }

      if (res && res.success && res.usages) {
        setUsages(res.usages);
      }
    } catch (err) {
      console.error('Failed to load usage ledger', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsages();
  }, [account?.role, activeTenantId]);

  const filteredUsages = useMemo(() => {
    return usages.filter(u => {
      const term = search.toLowerCase().trim();
      if (!term) return true;
      return (
        (u.actionName && u.actionName.toLowerCase().includes(term)) ||
        (u.tenantId && u.tenantId.toLowerCase().includes(term)) ||
        (u.description && u.description.toLowerCase().includes(term)) ||
        (u.siteId && u.siteId.toLowerCase().includes(term))
      );
    });
  }, [usages, search]);

  const stats = useMemo(() => {
    const totalConsumed = usages.reduce((sum, u) => sum + (u.creditsDeducted || 0), 0);
    const count = usages.length;
    const avgConsumed = count > 0 ? Math.round(totalConsumed / count) : 0;
    return { totalConsumed, count, avgConsumed };
  }, [usages]);

  const getActionBadgeClass = (action: string) => {
    switch (action) {
      case 'DRAFT_GENERATE':
        return 'bg-purple-50 text-purple-700';
      case 'AUTOPILOT_CRUISE':
      case 'CRUISE_PIPELINE':
        return 'bg-blue-50 text-blue-700';
      case 'COMPETITOR_ANALYSIS':
        return 'bg-amber-50 text-amber-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>累计算力扣除</span>
            <Activity className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {stats.totalConsumed.toLocaleString()} <span className="text-xs font-normal text-slate-500">积分</span>
          </div>
        </div>
      </div>

      {/* Main Billing Table Card */}
      <div className="bg-white border border-slate-200/80 rounded-lg shadow-sm overflow-hidden">
        
        {/* Table Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs font-bold text-slate-900">
            算力消耗流水 ({filteredUsages.length})
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索业务动作/租户/站点..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200/80 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400 w-full transition"
              />
            </div>
          </div>
        </div>

        {/* Mobile View Card List (Visible on mobile, hidden on md+) */}
        <div className="block md:hidden space-y-3.5 px-1 pb-4">
          {filteredUsages.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              暂无消耗账单流水明细
            </div>
          ) : (
            filteredUsages.map((u, index) => (
              <div key={`${u.id}-${index}`} className="bg-slate-50/50 p-4 rounded-xl space-y-3.5 transition hover:bg-slate-100/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{u.actionName || u.description || '算力消耗'}</div>
                    <div className="text-[11px] text-slate-400 mt-1 font-mono">
                      租户: {u.tenantId || 'tenant-a'}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 ${getActionBadgeClass(u.action)}`}>
                    <Layers className="w-3 h-3" /> {u.action}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">扣除积分</div>
                    <div className="font-mono font-black text-rose-600 text-sm mt-0.5 flex items-center">
                      <ArrowDownRight className="w-3.5 h-3.5" />
                      <span>-{u.creditsDeducted}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-slate-400 text-[10px] uppercase tracking-wider font-semibold">余额 / 时间</div>
                    <div className="text-slate-700 font-mono font-medium mt-0.5">
                      {(u.remainingCredits || 0).toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">Credits</span>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 font-mono pt-1 text-right">
                  {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false }) : '2026-08-24'}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Usages Table (Hidden on mobile, visible on desktop) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 border-b border-slate-100 text-xs font-semibold select-none">
                <th className="py-3 px-4">算力消耗动作 / 租户</th>
                <th className="py-3 px-4">业务分类</th>
                <th className="py-3 px-4">扣除积分</th>
                <th className="py-3 px-4">扣后余额</th>
                <th className="py-3 px-4 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredUsages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    暂无消耗账单流水明细
                  </td>
                </tr>
              ) : (
                filteredUsages.map((u, index) => (
                  <tr key={`${u.id}-${index}`} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{u.actionName || u.description || '算力消耗'}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        租户: {u.tenantId || 'tenant-a'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-lg ${getActionBadgeClass(u.action)}`}>
                        <Layers className="w-3 h-3" /> {u.action}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-rose-600 text-sm">
                      <div className="flex items-center gap-0.5">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        <span>-{u.creditsDeducted}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                      {(u.remainingCredits || 0).toLocaleString()}
                    </td>

                    <td className="py-3.5 px-4 text-right text-slate-400 font-mono text-[11px]">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false }) : '2026-08-24'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
