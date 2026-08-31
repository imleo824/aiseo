import React, { useState, useEffect, useMemo } from 'react';
import { Wallet, Search, RefreshCw, ExternalLink, Copy, Check, CreditCard, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { TenantAccount, CreditTransaction } from '../types/seo';
import { createApiService } from '../services/api';

interface ProSystemPaymentTabProps {
  account?: TenantAccount | null;
  activeTenantId?: string;
}

export const ProSystemPaymentTab: React.FC<ProSystemPaymentTabProps> = ({
  account,
  activeTenantId
}) => {
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchPaymentLogs = async () => {
    setLoading(true);
    try {
      const api = createApiService(activeTenantId);
      // Admin sees global transactions; tenant sees their own
      let res;
      if (account?.role === 'ADMIN') {
        res = await api.getAllTransactions();
      } else {
        res = await api.getCreditTransactions();
      }
      if (res.success && res.transactions) {
        // Filter only recharge type
        const recharges = res.transactions.filter(t => t.type === 'RECHARGE' || t.usdtAmount);
        setTransactions(recharges);
      }
    } catch (err) {
      console.error('Failed to load payment logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPaymentLogs();
  }, [account?.role, activeTenantId]);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const filteredTxs = useMemo(() => {
    return transactions.filter(tx => {
      const term = search.toLowerCase().trim();
      if (!term) return true;
      return (
        (tx.txHash && tx.txHash.toLowerCase().includes(term)) ||
        (tx.tenantId && tx.tenantId.toLowerCase().includes(term)) ||
        (tx.description && tx.description.toLowerCase().includes(term)) ||
        (tx.id && tx.id.toLowerCase().includes(term))
      );
    });
  }, [transactions, search]);

  const stats = useMemo(() => {
    const totalUsdt = transactions.reduce((sum, t) => sum + (t.usdtAmount || (t.amount > 0 ? t.amount / 100 : 0)), 0);
    const count = transactions.length;
    const avgUsdt = count > 0 ? Math.round(totalUsdt / count) : 0;
    const totalCreditsGranted = transactions.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), 0);
    return { totalUsdt, count, avgUsdt, totalCreditsGranted };
  }, [transactions]);

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>全平台 USDT 充值总额</span>
            <Wallet className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            ${stats.totalUsdt.toLocaleString()} <span className="text-xs font-normal text-slate-500">USDT</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-lg p-5 shadow-sm space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>充值交易总笔数</span>
            <CreditCard className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {stats.count} <span className="text-xs font-normal text-slate-500">笔</span>
          </div>
        </div>
      </div>

      {/* Main Payment Log Card */}
      <div className="bg-white border border-slate-200/80 rounded-lg shadow-sm overflow-hidden">

        {/* Table Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs font-bold text-slate-900">
            全平台充值明细 ({filteredTxs.length})
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索交易哈希/租户/描述..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200/80 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400 w-full transition"
              />
            </div>
          </div>
        </div>

        {/* Transactions Mobile View (Visible on mobile, hidden on md+) */}
        <div className="block md:hidden space-y-4 px-1 pb-4">
          {filteredTxs.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              暂无充值流水明细记录
            </div>
          ) : (
            filteredTxs.map((tx) => {
              const usdtVal = tx.usdtAmount || (tx.amount > 0 ? tx.amount / 100 : 0);
              const displayHash = tx.txHash || '尚未提交';
              const truncatedHash = displayHash.length > 18
                ? `${displayHash.substring(0, 8)}...${displayHash.substring(displayHash.length - 6)}`
                : displayHash;
              const statusKey = tx.status || 'CONFIRMED';

              return (
                <div key={tx.id} className="bg-slate-50/60 p-4 rounded-xl border border-slate-100 space-y-3.5 hover:border-slate-200 transition">
                  {/* Header: Title & Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{tx.description || 'USDT 充值'}</div>
                      <div className="text-[11px] text-slate-400 mt-1 font-mono">
                        租户: {tx.tenantId || '未知租户'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      {statusKey === 'CONFIRMED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> 已确认
                        </span>
                      )}
                      {statusKey === 'PENDING' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-800 rounded border border-amber-200">
                          <Clock className="w-3 h-3" /> 待核验
                        </span>
                      )}
                      {statusKey === 'REJECTED' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-rose-100 text-rose-800 rounded border border-rose-200">
                          <XCircle className="w-3 h-3" /> 已拒绝
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body values: USDT & Credits */}
                  <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-lg border border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-400 text-[10px] block font-medium">USDT 金额</span>
                      <span className="font-mono font-extrabold text-emerald-600 text-sm">+{usdtVal} USDT</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px] block font-medium">发放积分</span>
                      <span className="font-mono font-extrabold text-slate-800 text-sm">+{tx.amount.toLocaleString()} pts</span>
                    </div>
                  </div>

                  {/* Hash info */}
                  <div className="flex items-center justify-between text-xs pt-1">
                    <span className="text-slate-400 text-[11px]">交易哈希</span>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                      <span>{truncatedHash}</span>
                      {tx.txHash && <button
                        type="button"
                        onClick={() => handleCopyHash(displayHash)}
                        className="hover:text-slate-900 transition cursor-pointer"
                      >
                        {copiedHash === displayHash ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400" />
                        )}
                      </button>}
                      {tx.txHash && <a
                        href={`https://tronscan.org/#/transaction/${displayHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-blue-600 transition"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>}
                    </div>
                  </div>

                  {/* Actions (Only Admin) */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-400 text-[11px] font-mono shrink-0">
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString('zh-CN', { hour12: false }) : '2026-08-24'}
                    </span>
                    <span className="text-slate-400 text-[10px]">仅链上核验 Worker 可结算</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Transactions Table (Hidden on mobile, visible on desktop) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 text-slate-500 border-b border-slate-100 text-xs font-semibold select-none">
                <th className="py-3 px-4">充值类型 / 租户</th>
                <th className="py-3 px-4">USDT 金额</th>
                <th className="py-3 px-4">发放积分</th>
                <th className="py-3 px-4">区块链 TxHash (TRC20)</th>
                <th className="py-3 px-4">交割状态</th>
                <th className="py-3 px-4 text-center">操作 / 到账核验</th>
                <th className="py-3 px-4 text-right">时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTxs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    暂无充值流水明细记录
                  </td>
                </tr>
              ) : (
                filteredTxs.map((tx) => {
                  const usdtVal = tx.usdtAmount || (tx.amount > 0 ? tx.amount / 100 : 0);
                  const displayHash = tx.txHash || '尚未提交';
                  const truncatedHash = displayHash.length > 18
                    ? `${displayHash.substring(0, 8)}...${displayHash.substring(displayHash.length - 6)}`
                    : displayHash;

                  const statusKey = tx.status || 'CONFIRMED';

                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{tx.description || 'USDT 充值'}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                        租户: {tx.tenantId || '未知租户'}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-600 text-sm">
                        +{usdtVal}
                      </td>

                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800">
                        +{tx.amount.toLocaleString()}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded w-fit">
                          <span>{truncatedHash}</span>
                          {tx.txHash && <button
                            type="button"
                            onClick={() => handleCopyHash(displayHash)}
                            className="hover:text-slate-900 transition cursor-pointer"
                            title="复制哈希"
                          >
                            {copiedHash === displayHash ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3 text-slate-400" />
                            )}
                          </button>}
                          {tx.txHash && <a
                            href={`https://tronscan.org/#/transaction/${displayHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-blue-600 transition"
                            title="在 TronScan 上查看"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>}
                        </div>
                      </td>

                      {/* Status Column */}
                      <td className="py-3.5 px-4">
                        {statusKey === 'CONFIRMED' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-emerald-100 text-emerald-800 rounded border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> 已确认到账
                          </span>
                        )}
                        {statusKey === 'PENDING' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-800 rounded border border-amber-200">
                            <Clock className="w-3 h-3" /> 待核验到账
                          </span>
                        )}
                        {statusKey === 'REJECTED' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-rose-100 text-rose-800 rounded border border-rose-200">
                            <XCircle className="w-3 h-3" /> 已拒绝/未到账
                          </span>
                        )}
                      </td>

                      {/* Settlement is intentionally performed only by the chain-verification worker. */}
                      <td className="py-3.5 px-4 text-center">
                        {account?.role === 'ADMIN' ? (
                          <span className="text-[10px] text-slate-500">链上核验自动结算</span>
                        ) : (
                          <span className="text-slate-400 text-[11px]">系统自动校核</span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right text-slate-400 font-mono text-[11px]">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleString('zh-CN', { hour12: false }) : '2026-08-24'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
