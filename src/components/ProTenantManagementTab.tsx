import React, { useState, useEffect, useMemo } from 'react';
import { Users, Shield, Search, RefreshCw, ArrowRightLeft, CheckCircle2, Coins, CreditCard, UserCheck, PlusCircle, MinusCircle, X, AlertCircle } from 'lucide-react';
import { TenantAccount } from '../types/seo';
import { createApiService } from '../services/api';

interface ProTenantManagementTabProps {
  account?: TenantAccount | null;
  allTenants?: TenantAccount[];
  activeTenantId?: string;
  onSwitchTenant?: (tenantId: string) => void;
  onRefreshData?: () => void;
}

export const ProTenantManagementTab: React.FC<ProTenantManagementTabProps> = ({
  allTenants: initialTenants,
  activeTenantId = 'tenant-a',
  onSwitchTenant,
  onRefreshData
}) => {
  const [tenants, setTenants] = useState<TenantAccount[]>(initialTenants || []);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Modal State for Credit Adjustment
  const [adjustTarget, setAdjustTarget] = useState<TenantAccount | null>(null);
  const [adjustType, setAdjustType] = useState<'TOPUP' | 'DEDUCT'>('TOPUP');
  const [adjustAmount, setAdjustAmount] = useState<number>(500);
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [adjustMessage, setAdjustMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const api = createApiService(activeTenantId);
      const res = await api.listTenants();
      if (res.success && res.tenants) {
        setTenants(res.tenants);
      }
    } catch (err) {
      console.error('Failed to load tenants list', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTenants && initialTenants.length > 0) {
      setTenants(initialTenants);
    } else {
      fetchTenants();
    }
  }, [initialTenants]);

  const handleRefresh = async () => {
    await fetchTenants();
    if (onRefreshData) onRefreshData();
  };

  const handleSwitch = (tenantId: string) => {
    setSwitchingId(tenantId);
    setTimeout(() => {
      if (onSwitchTenant) {
        onSwitchTenant(tenantId);
      }
      setSwitchingId(null);
    }, 200);
  };

  const filteredTenants = useMemo(() => {
    return tenants.filter(t => {
      const term = search.toLowerCase().trim();
      const matchesSearch = !term || 
        t.username.toLowerCase().includes(term) ||
        t.id.toLowerCase().includes(term) ||
        t.email.toLowerCase().includes(term) ||
        (t.companyName && t.companyName.toLowerCase().includes(term));
      return matchesSearch;
    });
  }, [tenants, search]);

  // Overall Statistics
  const stats = useMemo(() => {
    const totalCount = tenants.length;
    const adminCount = tenants.filter(t => t.role === 'ADMIN').length;
    const totalCredits = tenants.reduce((acc, t) => acc + (t.credits || 0), 0);
    const totalUsdt = tenants.reduce((acc, t) => acc + (t.totalRechargedUsdt || 0), 0);
    return { totalCount, adminCount, totalCredits, totalUsdt };
  }, [tenants]);

  const handleOpenAdjustModal = (tenant: TenantAccount) => {
    setAdjustTarget(tenant);
    setAdjustType('TOPUP');
    setAdjustAmount(500);
    setAdjustReason('');
    setAdjustMessage(null);
  };

  const handleSubmitAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;

    if (!adjustAmount || adjustAmount <= 0) {
      setAdjustMessage({ type: 'error', text: '请输入有效的变动积分数量' });
      return;
    }

    const delta = adjustType === 'TOPUP' ? Math.abs(adjustAmount) : -Math.abs(adjustAmount);
    setSubmitting(true);
    setAdjustMessage(null);

    try {
      const api = createApiService(activeTenantId);
      const res = await api.adjustTenantCredits(adjustTarget.id, delta, adjustReason);
      if (res.success) {
        setAdjustMessage({ type: 'success', text: res.message });
        setTimeout(() => {
          setAdjustTarget(null);
          handleRefresh();
        }, 1200);
      } else {
        setAdjustMessage({ type: 'error', text: res.message || '操作失败' });
      }
    } catch (err: any) {
      setAdjustMessage({ type: 'error', text: err.message || '网络或系统异常，请重试' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      
      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>总租户规模</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {stats.totalCount} <span className="text-xs font-normal text-slate-500">家</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>平台积分可用池</span>
            <Coins className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {stats.totalCredits.toLocaleString()} <span className="text-xs font-normal text-slate-500">积分</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>累计充值 (USDT)</span>
            <CreditCard className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            ${stats.totalUsdt.toLocaleString()} <span className="text-xs font-normal text-slate-500">USDT</span>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white border border-slate-200/80 rounded-lg shadow-sm overflow-hidden">
        
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs font-bold text-slate-900">
            全部租户列表 ({filteredTenants.length})
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索租户名、Email或ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200/80 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400 w-full transition"
              />
            </div>
          </div>
        </div>

        {/* Tenants Mobile View (Visible on mobile, hidden on md+) */}
        <div className="block md:hidden space-y-4 px-1 pb-4">
          {filteredTenants.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              未查找到匹配的租户记录
            </div>
          ) : (
            filteredTenants.map((t) => {
              const isActive = t.id === activeTenantId;
              return (
                <div 
                  key={t.id} 
                  className={`p-4 rounded-xl border space-y-3.5 transition ${isActive ? 'bg-blue-50/20 border-blue-200 shadow-xs' : 'bg-slate-50/60 border-slate-100 hover:border-slate-200'}`}
                >
                  {/* Title & Role */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 ${t.role === 'ADMIN' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                        {t.username.substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5 flex-wrap">
                          <span>{t.companyName || t.username}</span>
                          {isActive && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-800 rounded font-black uppercase">
                              <UserCheck className="w-2.5 h-2.5" /> 当前
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          ID: {t.id} · {t.email}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {t.role === 'ADMIN' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black bg-indigo-100 text-indigo-800 rounded border border-indigo-200">
                          管理员
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded border border-slate-200/80">
                          租户
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics details */}
                  <div className="grid grid-cols-3 gap-2 bg-white p-2.5 rounded-lg border border-slate-100 text-center text-xs">
                    <div>
                      <span className="text-slate-400 text-[9px] block">可用积分</span>
                      <span className={`font-mono font-black text-[13px] block mt-0.5 ${t.credits < 100 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {t.credits.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[9px] block">累计充值</span>
                      <span className="font-mono font-extrabold text-slate-700 text-[13px] block mt-0.5">
                        ${t.totalRechargedUsdt || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[9px] block">已消耗</span>
                      <span className="font-mono font-semibold text-slate-500 text-[13px] block mt-0.5">
                        {(t.totalConsumedCredits || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions & Created Date */}
                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-3 text-xs flex-wrap">
                    <span className="text-slate-400 text-[10px] font-mono">
                      注册: {t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN') : '2026-08-24'}
                    </span>

                    <div className="flex items-center gap-1.5 ml-auto">
                      <button
                        type="button"
                        onClick={() => handleOpenAdjustModal(t)}
                        className="px-2.5 py-1 text-[11px] font-bold text-indigo-700 bg-white hover:bg-indigo-50 border border-slate-200/80 rounded-md transition flex items-center gap-1 cursor-pointer"
                      >
                        <Coins className="w-3 h-3 text-indigo-600" /> 上下分
                      </button>
                      
                      {!isActive && (
                        <button
                          type="button"
                          onClick={() => handleSwitch(t.id)}
                          disabled={switchingId === t.id}
                          className="px-2.5 py-1 text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition cursor-pointer"
                        >
                          模拟视角
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Tenant Table (Hidden on mobile, visible on desktop) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 border-b border-slate-100 text-xs font-semibold select-none">
                <th className="py-3 px-4">租户标识 / 名称</th>
                <th className="py-3 px-4">账号类型</th>
                <th className="py-3 px-4">可用积分</th>
                <th className="py-3 px-4">累计充值 USDT</th>
                <th className="py-3 px-4">已消耗积分</th>
                <th className="py-3 px-4">注册时间</th>
                <th className="py-3 px-4 text-center">上下分</th>
                <th className="py-3 px-4 text-right">视角切换</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    未查找到匹配的租户记录
                  </td>
                </tr>
              ) : (
                filteredTenants.map((t) => {
                  const isActive = t.id === activeTenantId;
                  return (
                    <tr 
                      key={t.id} 
                      className={`hover:bg-slate-50/60 transition ${isActive ? 'bg-blue-50/30 font-medium' : ''}`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs ${t.role === 'ADMIN' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                            {t.username.substring(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span>{t.companyName || t.username}</span>
                              {isActive && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 text-[10px] bg-blue-100 text-blue-800 rounded font-bold">
                                  <UserCheck className="w-2.5 h-2.5" /> 当前
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              ID: {t.id} · {t.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        {t.role === 'ADMIN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-indigo-100 text-indigo-800 rounded border border-indigo-200">
                            <Shield className="w-3 h-3" /> 管理员
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-700 rounded border border-slate-200/80">
                            租户
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        <span className={`px-2 py-0.5 rounded ${t.credits < 100 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
                          {t.credits.toLocaleString()}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                        {t.totalRechargedUsdt || 0}
                      </td>

                      <td className="py-3.5 px-4 font-mono text-slate-500">
                        {(t.totalConsumedCredits || 0).toLocaleString()}
                      </td>

                      <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">
                        {t.createdAt ? new Date(t.createdAt).toLocaleDateString('zh-CN') : '2026-08-01'}
                      </td>

                      {/* Manual Credit Adjustment Trigger */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleOpenAdjustModal(t)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded transition cursor-pointer"
                          title="手动上分/下扣积分"
                        >
                          <Coins className="w-3 h-3 text-indigo-600" />
                          上下分
                        </button>
                      </td>

                      {/* Perspective Switch */}
                      <td className="py-3.5 px-4 text-right">
                        {isActive ? (
                          <span className="text-[11px] font-semibold text-blue-600 flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> 已激活
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSwitch(t.id)}
                            disabled={switchingId === t.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200/80 hover:bg-slate-100 rounded transition cursor-pointer disabled:opacity-50"
                          >
                            <ArrowRightLeft className="w-3 h-3 text-slate-500" />
                            切换视角
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* Credit Adjustment Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl max-w-md w-full p-4 sm:p-6 shadow-xl space-y-5 border border-slate-200/80">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  <Coins className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">手动算力上下分</h3>
                  <p className="text-xs text-slate-500">目标租户: <span className="font-semibold text-slate-800">{adjustTarget.companyName || adjustTarget.username}</span> ({adjustTarget.id})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitAdjust} className="space-y-4">
              
              {/* Type Switcher */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">操作类型</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setAdjustType('TOPUP')}
                    className={`flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-md transition ${adjustType === 'TOPUP' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <PlusCircle className="w-4 h-4" />
                    上分 (+ 充值积分)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType('DEDUCT')}
                    className={`flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-md transition ${adjustType === 'DEDUCT' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <MinusCircle className="w-4 h-4" />
                    下分 (- 扣减积分)
                  </button>
                </div>
              </div>

              {/* Quick Preset Pills & Amount Input */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">变动积分数</label>
                <div className="flex items-center gap-2">
                  {[200, 500, 1000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setAdjustAmount(amt)}
                      className={`px-2.5 py-1 text-xs rounded border transition font-mono ${adjustAmount === amt ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-bold' : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:bg-slate-100'}`}
                    >
                      {amt} 积分
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(Math.max(1, parseInt(e.target.value) || 0))}
                  className="w-full px-3 py-2 text-sm border border-slate-200/80 rounded-md focus:outline-none focus:border-indigo-500 font-mono font-bold"
                  placeholder="请输入积分数量"
                  required
                />
              </div>

              {/* Adjustment Reason */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700">调整原因 / 变动备注</label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-200/80 rounded-md focus:outline-none focus:border-indigo-500"
                  placeholder="例如: 客服赠送体验包、任务异常补偿、违规退回等"
                  required
                />
              </div>

              {/* Preview Box */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-lg text-xs space-y-1">
                <div className="flex justify-between text-slate-500">
                  <span>当前可用积分:</span>
                  <span className="font-mono font-bold text-slate-800">{adjustTarget.credits.toLocaleString()} 积分</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>本次变动:</span>
                  <span className={`font-mono font-bold ${adjustType === 'TOPUP' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {adjustType === 'TOPUP' ? '+' : '-'}{adjustAmount.toLocaleString()} 积分
                  </span>
                </div>
                <div className="pt-1 border-t border-slate-200/80 flex justify-between font-semibold text-slate-900">
                  <span>调整后预计余额:</span>
                  <span className="font-mono font-extrabold text-indigo-600">
                    {Math.max(0, adjustTarget.credits + (adjustType === 'TOPUP' ? adjustAmount : -adjustAmount)).toLocaleString()} 积分
                  </span>
                </div>
              </div>

              {/* Alert message */}
              {adjustMessage && (
                <div className={`p-3 rounded-lg text-xs flex items-center gap-2 ${adjustMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{adjustMessage.text}</span>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {submitting ? '提交中...' : '确认调账提交'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
};
