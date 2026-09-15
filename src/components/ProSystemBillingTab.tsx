import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Search, RefreshCw, Layers, ArrowDownRight, AlertCircle } from 'lucide-react';
import { TenantAccount } from '../types/seo';
import { createApiService } from '../services/api';
import { absoluteDecimal, compareDecimals, divideDecimalByInteger, formatDecimal, sumDecimals } from '../lib/fixedDecimal';

interface UsageRecord {
  id: string;
  tenantId: string;
  siteId?: string;
  taskId?: string;
  action: string;
  actionName: string;
  creditsDeducted: string;
  remainingCredits?: string;
  createdAt: string;
  description?: string;
}

interface ProSystemBillingTabProps {
  account?: TenantAccount | null;
  activeTenantId?: string;
}

export const ProSystemBillingTab: React.FC<ProSystemBillingTabProps> = ({
  account,
  activeTenantId
}) => {
  const [usages, setUsages] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchUsages = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const api = createApiService(activeTenantId);
      let res;
      if (account?.role === 'ADMIN') {
        res = await api.getAllUsages();
      } else {
        // Tenant view fallback
        const txRes = await api.getCreditTransactions();
        if (txRes.success && txRes.transactions) {
          const consumeTxs = txRes.transactions.filter(t => t.type === 'CONSUME' || compareDecimals(t.amount, '0') < 0);
          res = {
            success: true,
            usages: consumeTxs.map(t => ({
              id: t.id,
              tenantId: t.tenantId,
              siteId: t.metadata?.siteId,
              taskId: t.metadata?.taskId,
              action: t.action,
              actionName: t.description || t.action,
              creditsDeducted: absoluteDecimal(t.amount),
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
      setLoadError(err instanceof Error ? err.message : '消耗流水加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsages();
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
    const totalConsumed = sumDecimals(...usages.map((usage) => usage.creditsDeducted));
    const count = usages.length;
    const avgConsumed = count > 0 ? divideDecimalByInteger(totalConsumed, count) : '0';
    return { totalConsumed, count, avgConsumed };
  }, [usages]);

  const getActionBadgeClass = (action: string) => {
    return action === 'GROWTH_RUN'
      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/80'
      : 'bg-slate-100 text-slate-800 border border-slate-200/80';
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-600 text-xs font-bold">
            <span>累计用量扣费</span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shadow-2xs">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-950 tracking-tight">
            {formatDecimal(stats.totalConsumed)} <span className="text-xs font-medium text-slate-500">积分</span>
          </div>
        </div>
      </div>

      {/* Main Billing Table Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-2xs overflow-hidden">

        {/* Table Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="text-xs font-bold text-slate-950">
            业务用量流水 ({filteredUsages.length})
          </div>

          <div className="flex items-center gap-2">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="搜索业务动作、客户工作区或站点..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3.5 py-2 text-xs sm:text-sm border border-slate-200/90 rounded-xl bg-slate-50/80 hover:bg-slate-100/60 focus:bg-white focus:outline-none focus:border-slate-400 w-full transition-colors min-h-[38px]"
              />
            </div>
            <button
              type="button"
              onClick={() => void fetchUsages()}
              disabled={loading}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200/90 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800 transition hover:bg-slate-200 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        {loadError && (
          <div className="m-4 flex items-start gap-2 rounded-xl border border-rose-200/90 bg-rose-50 p-3.5 text-xs font-medium text-rose-800" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>消耗流水暂时无法加载：{loadError}</span>
          </div>
        )}

        {/* Mobile View Card List (Visible on mobile, hidden on md+) */}
        <div className="block md:hidden space-y-3 p-3.5">
          {filteredUsages.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              {loading ? '正在加载消耗流水…' : '暂无消耗账单流水明细'}
            </div>
          ) : (
            filteredUsages.map((u, index) => (
              <div key={`${u.id}-${index}`} className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 space-y-3 transition hover:bg-slate-100/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-950 text-sm leading-snug">{u.actionName || u.description || '增长动作扣费'}</div>
                    <div className="text-[11px] text-slate-500 mt-1 font-mono">
                      客户工作区: {u.tenantId || '未知工作区'}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg shrink-0 ${getActionBadgeClass(u.action)}`}>
                    <Layers className="w-3 h-3" /> {u.action}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-slate-200/60 text-xs">
                  <div>
                    <div className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">扣除积分</div>
                    <div className="font-mono font-black text-rose-600 text-sm mt-0.5 flex items-center">
                      <ArrowDownRight className="w-3.5 h-3.5" />
                      <span>-{formatDecimal(u.creditsDeducted)}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">余额</div>
                    <div className="text-slate-800 font-mono font-bold mt-0.5">
                      {u.remainingCredits === undefined ? '未记录' : formatDecimal(u.remainingCredits)} {u.remainingCredits !== undefined && <span className="text-[10px] text-slate-500 font-normal">Credits</span>}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 font-mono pt-1 text-right">
                  {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Usages Table (Hidden on mobile, visible on desktop) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-600 border-b border-slate-100 text-xs font-semibold select-none">
                <th className="py-3.5 px-4">业务动作 / 客户工作区</th>
                <th className="py-3.5 px-4">业务分类</th>
                <th className="py-3.5 px-4">扣除积分</th>
                <th className="py-3.5 px-4">扣后余额</th>
                <th className="py-3.5 px-4 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredUsages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    {loading ? '正在加载消耗流水…' : '暂无消耗账单流水明细'}
                  </td>
                </tr>
              ) : (
                filteredUsages.map((u, index) => (
                  <tr key={`${u.id}-${index}`} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-950">{u.actionName || u.description || '增长动作扣费'}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        客户工作区: {u.tenantId || '未知工作区'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded-lg ${getActionBadgeClass(u.action)}`}>
                        <Layers className="w-3 h-3" /> {u.action}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-black text-rose-600 text-sm">
                      <div className="flex items-center gap-0.5">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        <span>-{formatDecimal(u.creditsDeducted)}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                      {u.remainingCredits === undefined ? '未记录' : formatDecimal(u.remainingCredits)}
                    </td>

                    <td className="py-3.5 px-4 text-right text-slate-500 font-mono text-[11px]">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'}
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
