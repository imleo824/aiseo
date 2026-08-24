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
  const [actionFilter, setActionFilter] = useState<string>('ALL');

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
      const matchesAction = actionFilter === 'ALL' || u.action === actionFilter;
      const term = search.toLowerCase().trim();
      if (!term) return matchesAction;
      return matchesAction && (
        (u.actionName && u.actionName.toLowerCase().includes(term)) ||
        (u.tenantId && u.tenantId.toLowerCase().includes(term)) ||
        (u.description && u.description.toLowerCase().includes(term)) ||
        (u.siteId && u.siteId.toLowerCase().includes(term))
      );
    });
  }, [usages, actionFilter, search]);

  const stats = useMemo(() => {
    const totalConsumed = usages.reduce((sum, u) => sum + (u.creditsDeducted || 0), 0);
    const count = usages.length;
    const avgConsumed = count > 0 ? Math.round(totalConsumed / count) : 0;
    return { totalConsumed, count, avgConsumed };
  }, [usages]);

  const getActionBadgeClass = (action: string) => {
    switch (action) {
      case 'DRAFT_GENERATE':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'AUTOPILOT_CRUISE':
      case 'CRUISE_PIPELINE':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'COMPETITOR_ANALYSIS':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-1">
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
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        
        {/* Table Header */}
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center shadow-2xs">
              <Activity className="w-4 h-4 text-rose-400" />
            </span>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">消耗管理</h2>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Action Filter Pills */}
            <div className="inline-flex rounded-md bg-slate-100 p-0.5 border border-slate-200 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActionFilter('ALL')}
                className={`px-2.5 py-1 rounded-sm transition ${actionFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setActionFilter('AUTOPILOT_CRUISE')}
                className={`px-2.5 py-1 rounded-sm transition ${actionFilter === 'AUTOPILOT_CRUISE' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                自动巡航
              </button>
              <button
                type="button"
                onClick={() => setActionFilter('DRAFT_GENERATE')}
                className={`px-2.5 py-1 rounded-sm transition ${actionFilter === 'DRAFT_GENERATE' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-500 hover:text-slate-800'}`}
              >
                文章创作
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索业务动作/租户..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400 w-48 transition"
              />
            </div>

            <button
              type="button"
              onClick={fetchUsages}
              disabled={loading}
              className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
              title="刷新账单明细"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-rose-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Usages Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 border-b border-slate-100 text-xs font-semibold select-none">
                <th className="py-3 px-4">算力消耗动作 / 租户</th>
                <th className="py-3 px-4">业务分类</th>
                <th className="py-3 px-4">扣除积分</th>
                <th className="py-3 px-4">扣后余额</th>
                <th className="py-3 px-4">上下文句柄</th>
                <th className="py-3 px-4 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredUsages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    暂无消耗账单流水明细
                  </td>
                </tr>
              ) : (
                filteredUsages.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{u.actionName || u.description || '算力消耗'}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        租户: {u.tenantId || 'tenant-a'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded border ${getActionBadgeClass(u.action)}`}>
                        <Layers className="w-3 h-3" /> {u.action}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-bold text-rose-600 text-sm">
                      <div className="flex items-center gap-0.5">
                        <ArrowDownRight className="w-3.5 h-3.5" />
                        <span>-{u.creditsDeducted} 积分</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                      {(u.remainingCredits || 0).toLocaleString()} 积分
                    </td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400">
                      {u.siteId ? `站点: ${u.siteId}` : u.taskId ? `任务: ${u.taskId}` : '全局系统任务'}
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
