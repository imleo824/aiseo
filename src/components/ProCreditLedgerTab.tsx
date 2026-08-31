import React, { useState, useMemo, useEffect } from 'react';
import {
  CreditTransaction,
  TenantAccount,
  CreditTransactionType,
  ActionPricingItem
} from '../types/seo';
import {
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Download,
  Check,
  Copy,
  Zap,
  Globe,
  HelpCircle
} from 'lucide-react';
import { ApiService } from '../services/api';

interface ProCreditLedgerTabProps {
  account: TenantAccount | null;
  transactions: CreditTransaction[];
  tenantId: string;
}

export const ProCreditLedgerTab: React.FC<ProCreditLedgerTabProps> = ({
  account,
  transactions = [],
  tenantId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<CreditTransactionType | 'ALL'>('ALL');
  const [timeFilter, setTimeFilter] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showRatesGuide, setShowRatesGuide] = useState(false);

  // 动态计费标准与业务价格
  const [systemRate, setSystemRate] = useState<string>('1 USDT = 100 基础积分');
  const [actionPricing, setActionPricing] = useState<ActionPricingItem[]>([
    { action: 'CRUISE_PIPELINE', name: '文章生成与发布 (按篇计费)', credits: 100, desc: '单篇标准定价 ($1.00/篇)：选题、长文、质量门禁、内链、站点发布与收录监测；普通文章不伪称 Google 实时收录', enabled: true },
    { action: 'COMPETITOR_ANALYSIS', name: '我的词库 智能挖掘与拓词分析 (按次计费)', credits: 50, desc: '单次标准定价 ($0.50/次)：母词裂变拓词、高意图长尾挖掘、竞品词库逆向穿透与搜索意图聚类', enabled: true }
  ]);

  useEffect(() => {
    const api = new ApiService(tenantId);
    api.getCreditConfig()
      .then(res => {
        if (res.rate) setSystemRate(res.rate);
        if (res.actionPricing && res.actionPricing.length > 0) {
          setActionPricing(res.actionPricing.map(item => ({
            action: item.action,
            name: item.name || item.action,
            credits: item.credits,
            desc: item.desc,
            enabled: item.enabled !== false
          })));
        }
      })
      .catch(() => {});
  }, [tenantId]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredTransactions = useMemo(() => {
    const now = Date.now();
    return transactions.filter(tx => {
      if (selectedType !== 'ALL' && tx.type !== selectedType) {
        return false;
      }

      if (timeFilter !== 'ALL') {
        const txTime = new Date(tx.createdAt).getTime();
        const diffHours = (now - txTime) / (1000 * 60 * 60);
        if (timeFilter === 'TODAY' && diffHours > 24) return false;
        if (timeFilter === 'WEEK' && diffHours > 24 * 7) return false;
        if (timeFilter === 'MONTH' && diffHours > 24 * 30) return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchDesc = tx.description?.toLowerCase().includes(query);
        const matchAction = tx.action?.toLowerCase().includes(query);
        const matchTxHash = tx.txHash?.toLowerCase().includes(query);
        const matchId = tx.id?.toLowerCase().includes(query);
        const matchSite = tx.metadata?.siteName?.toLowerCase().includes(query) || tx.metadata?.domain?.toLowerCase().includes(query);
        const matchKeyword = tx.metadata?.keyword?.toLowerCase().includes(query);
        return Boolean(matchDesc || matchAction || matchTxHash || matchId || matchSite || matchKeyword);
      }

      return true;
    });
  }, [transactions, selectedType, timeFilter, searchQuery]);

  const stats = useMemo(() => {
    let totalRechargeAmount = 0;
    let totalConsumeAmount = 0;

    transactions.forEach(tx => {
      if (tx.type === 'RECHARGE') totalRechargeAmount += tx.amount;
      if (tx.type === 'CONSUME') totalConsumeAmount += Math.abs(tx.amount);
    });

    return {
      totalRechargeAmount,
      totalConsumeAmount,
      totalCount: transactions.length
    };
  }, [transactions]);

  const handleExportCsv = () => {
    if (filteredTransactions.length === 0) return;

    const headers = ['流水号', '时间', '交易类型', '业务类型', '变动积分', '交易后余额', 'USDT金额', '网络', '交易Hash', '说明', '关联站点', '关联关键词'];
    const rows = filteredTransactions.map(tx => [
      `"${tx.id}"`,
      `"${new Date(tx.createdAt).toLocaleString('zh-CN')}"`,
      `"${tx.type}"`,
      `"${tx.action}"`,
      tx.type === 'CONSUME' ? `-${Math.abs(tx.amount)}` : `+${tx.amount}`,
      tx.balance,
      tx.usdtAmount || '',
      tx.network || '',
      `"${tx.txHash || ''}"`,
      `"${tx.description.replace(/"/g, '""')}"`,
      `"${tx.metadata?.siteName || tx.metadata?.domain || ''}"`,
      `"${tx.metadata?.keyword || ''}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `aiseo-billing-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getTypeBadge = (type: CreditTransactionType) => {
    switch (type) {
      case 'RECHARGE':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            <ArrowDownLeft className="w-3 h-3 text-emerald-600" />
            充值入账
          </span>
        );
      case 'CONSUME':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200/80">
            <ArrowUpRight className="w-3 h-3 text-slate-500" />
            业务消耗
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {showRatesGuide && (
        <div className="bg-slate-900 text-white p-4 sm:p-6 rounded-lg border border-slate-800 shadow-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">当前各业务实时计费费率标准</h3>
            </div>
            <span className="text-xs text-slate-400">兑换汇率：{systemRate} (TRC20 网络)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {actionPricing.map((item, idx) => {
              const colors = [
                'text-emerald-400',
                'text-emerald-400',
                'text-indigo-400',
                'text-amber-400',
                'text-sky-400'
              ];
              const colorClass = colors[idx % colors.length];

              return (
                <div key={item.action} className="bg-slate-800/80 p-3.5 rounded-lg border border-slate-700/60 flex flex-col justify-between">
                  <div>
                    <div className="text-xs font-medium text-slate-300 mb-1">{item.name}</div>
                    <div className={`text-lg font-black ${colorClass}`}>
                      {item.credits} <span className="text-xs font-normal text-slate-400">积分/次</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2 line-clamp-2">{item.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200/80/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-bold text-slate-600">当前可用积分</span>
              <div className="w-7 h-7 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600">
                <Coins className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {account?.credits ?? 0}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400">折合 USDT 估值</span>
            <span className="font-semibold text-slate-700">
              ≈ {((account?.credits ?? 0) / 100).toFixed(2)} USDT
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200/80/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <div className="flex items-center gap-1.5 select-none">
                <span className="text-xs font-bold text-slate-600">累计业务消耗</span>
                <button
                  type="button"
                  onClick={() => setShowRatesGuide(!showRatesGuide)}
                  className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition cursor-pointer"
                  title="点击查看各业务计费标准"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="w-7 h-7 rounded-md bg-amber-50 flex items-center justify-center text-amber-600">
                <ArrowUpRight className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {account?.totalConsumedCredits ?? stats.totalConsumeAmount} <span className="text-sm font-semibold text-slate-500">积分</span>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-400">折合消耗金额</span>
            <span className="font-semibold text-amber-600">
              {((account?.totalConsumedCredits ?? stats.totalConsumeAmount) / 100).toFixed(2)} USDT
            </span>
          </div>
        </div>
      </div>

      {/* Transactions Section without redundant outer double borders */}
      <div className="space-y-4">
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            {(
              [
                { key: 'ALL', label: '全部交易' },
                { key: 'RECHARGE', label: '充值入账' },
                { key: 'CONSUME', label: '业务消耗' }
              ] as const
            ).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSelectedType(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  selectedType === tab.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Export */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索说明/站点/关键词/Hash..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-1.5 text-xs bg-slate-50 border border-slate-200/80 rounded-lg focus:outline-none focus:bg-white focus:border-slate-400 transition-colors"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={timeFilter}
                onChange={e => setTimeFilter(e.target.value as any)}
                className="flex-1 sm:flex-none px-3 py-1.5 text-xs bg-slate-50 border border-slate-200/80 rounded-lg text-slate-700 focus:outline-none focus:border-slate-400 transition-colors cursor-pointer"
              >
                <option value="ALL">全部时间</option>
                <option value="TODAY">今天 (24h)</option>
                <option value="WEEK">近 7 天</option>
                <option value="MONTH">近 30 天</option>
              </select>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredTransactions.length === 0}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                title="导出 CSV 账单"
              >
                <Download className="w-3.5 h-3.5" />
                <span>导出 CSV</span>
              </button>
            </div>
          </div>
        </div>

        {filteredTransactions.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-xl border border-slate-200/80">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Coins className="w-6 h-6" />
            </div>
            <h4 className="text-sm font-bold text-slate-900 mb-1">暂无符合条件的账单明细</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              当前暂未查询到相关交易记录，完成充值或执行自动发文、巡航任务后将在此处实时生成对账流水。
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-xs">
            {filteredTransactions.map(tx => {
              const isPositive = tx.type === 'RECHARGE';

              return (
                <div
                  key={tx.id}
                  className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  {/* Left: Icon, Type, Description, Metadata */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      tx.type === 'RECHARGE' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {tx.type === 'RECHARGE' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-slate-900">
                          {tx.description}
                        </span>
                        {getTypeBadge(tx.type)}
                        {tx.network && (
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-900 text-emerald-400 rounded-md">
                            {tx.network}
                          </span>
                        )}
                      </div>

                      {/* Details & Tags */}
                      <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-400">
                        <span>{new Date(tx.createdAt).toLocaleString('zh-CN')}</span>

                        {tx.metadata?.siteName && (
                          <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px] font-medium">
                            <Globe className="w-3 h-3 text-slate-400" />
                            {tx.metadata.siteName}
                          </span>
                        )}

                        {tx.metadata?.keyword && (
                          <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px] font-medium">
                            关键词: {tx.metadata.keyword}
                          </span>
                        )}

                        {tx.txHash && (
                          <div className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
                            <span>Hash: {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(tx.txHash!, tx.id)}
                              className="p-1 hover:text-slate-900 transition-colors cursor-pointer"
                              title="复制交易 Hash"
                            >
                              {copiedId === tx.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Amount & Balance Snapshot */}
                  <div className="sm:text-right shrink-0 pl-13 sm:pl-0">
                    <div className={`text-base font-black tracking-tight ${
                      isPositive ? 'text-emerald-600' : 'text-slate-800'
                    }`}>
                      {isPositive ? `+${tx.amount}` : `-${Math.abs(tx.amount)}`}
                    </div>

                    {tx.usdtAmount && (
                      <div className="text-xs font-medium text-emerald-700">
                        ({tx.usdtAmount})
                      </div>
                    )}

                    <div className="text-xs text-slate-400 mt-0.5">
                      变动后余额: <span className="font-semibold text-slate-600">{tx.balance}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
