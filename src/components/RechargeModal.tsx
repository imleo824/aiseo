import React, { useState, useEffect } from 'react';
import { 
  X, 
  Coins, 
  Copy, 
  Check, 
  ShieldCheck, 
  Zap
} from 'lucide-react';
import { UsdtPackage, UsdtNetwork, TenantAccount } from '../types/seo';
import { ApiService } from '../services/api';

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: TenantAccount | null;
  onRechargeSuccess: (usdtAmount: number, txHash?: string, network?: UsdtNetwork, packageId?: string) => Promise<any>;
  tenantId: string;
}

export const RechargeModal: React.FC<RechargeModalProps> = ({
  isOpen,
  onClose,
  account,
  onRechargeSuccess,
  tenantId
}) => {
  const [selectedPkgId, setSelectedPkgId] = useState<string>('pkg-50');
  const [customUsdt, setCustomUsdt] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [packages, setPackages] = useState<UsdtPackage[]>([
    { id: 'pkg-10', name: '基础体验包', badge: '入门推荐', usdtAmount: 10, credits: 1000, bonusCredits: 0 },
    { id: 'pkg-50', name: '专业进阶包', badge: '最受欢迎 (+10%)', usdtAmount: 50, credits: 5500, bonusCredits: 500, popular: true },
    { id: 'pkg-100', name: '企业旗舰包', badge: '超值特惠 (+20%)', usdtAmount: 100, credits: 12000, bonusCredits: 2000 },
    { id: 'pkg-300', name: '霸屏尊享包', badge: '大宗特惠 (+33%)', usdtAmount: 300, credits: 40000, bonusCredits: 10000 }
  ]);

  const [wallets, setWallets] = useState<Record<string, { network: string; address: string; qrCodePlaceholder: string }>>({
    TRC20: {
      network: 'USDT',
      address: 'TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1',
      qrCodePlaceholder: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=TLv5R4q9k8YJ3Z2QxP8wK1M7n6VbC9XyZ1'
    }
  });

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      const api = new ApiService(tenantId);
      api.getCreditConfig().then(res => {
        if (res.packages) setPackages(res.packages);
        if (res.wallets) setWallets(res.wallets);
      }).catch(() => {});
    }
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  const currentWallet = wallets['TRC20'] || Object.values(wallets)[0];
  const selectedPkg = packages.find(p => p.id === selectedPkgId);

  const calculateCredits = () => {
    if (selectedPkgId === 'custom') {
      const val = parseFloat(customUsdt) || 0;
      return Math.floor(val * 100);
    }
    return selectedPkg ? selectedPkg.credits : 0;
  };

  const getUsdtAmount = () => {
    if (selectedPkgId === 'custom') {
      return parseFloat(customUsdt) || 0;
    }
    return selectedPkg ? selectedPkg.usdtAmount : 0;
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(currentWallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmitRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const amount = getUsdtAmount();
    if (amount <= 0) {
      setError('请选择充值套餐或输入有效的 USDT 金额');
      return;
    }

    setLoading(true);
    try {
      const res = await onRechargeSuccess(
        amount, 
        undefined, 
        'TRC20', 
        selectedPkgId !== 'custom' ? selectedPkgId : undefined
      );
      setSuccessMsg(res?.message || `充值成功！已到账 ${calculateCredits()} 积分`);
      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err: any) {
      setError(err?.message || '充值处理失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div 
        id="recharge-modal-card" 
        className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500/20 to-emerald-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">USDT 充值兑换积分</h3>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full">
                  1 USDT = 100 积分
                </span>
              </div>
              <p className="text-xs text-slate-400">当前余额: <span className="font-semibold text-amber-400">{account?.credits ?? 0}</span> 积分</p>
            </div>
          </div>
          <button 
            id="btn-close-recharge-modal"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {successMsg && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center gap-3 animate-fadeIn">
              <Check className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium">{successMsg}</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-center gap-3">
              <X className="w-5 h-5 text-red-400 shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* 1. 选择充值套餐 */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
              选择 USDT 充值套餐
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {packages.map((pkg) => {
                const isSelected = selectedPkgId === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => {
                      setSelectedPkgId(pkg.id);
                      setCustomUsdt('');
                    }}
                    className={`relative p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500 shadow-md shadow-amber-500/10 ring-1 ring-amber-500'
                        : 'bg-slate-800/60 border-slate-700/80 hover:bg-slate-800 hover:border-slate-600'
                    }`}
                  >
                    {pkg.popular && (
                      <span className="absolute -top-2 right-2 px-1.5 py-0.2 text-[9px] font-bold uppercase bg-gradient-to-r from-amber-500 to-emerald-500 text-slate-950 rounded-full shadow">
                        推荐
                      </span>
                    )}
                    <div className="text-xs text-slate-400 font-medium mb-0.5">{pkg.name}</div>
                    <div className="text-base font-extrabold text-white mb-0.5">
                      ${pkg.usdtAmount} <span className="text-xs font-normal text-slate-400">USDT</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-semibold text-amber-400">
                      <Zap className="w-3.5 h-3.5" />
                      {pkg.credits.toLocaleString()} 积分
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 自定义金额 */}
            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => setSelectedPkgId('custom')}
                className={`w-full p-2.5 rounded-xl border text-left text-xs flex items-center justify-between transition-all cursor-pointer ${
                  selectedPkgId === 'custom'
                    ? 'bg-amber-500/10 border-amber-500 text-white'
                    : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <span>或者自定义 USDT 充值金额</span>
                <span className="text-amber-400 font-semibold">1 USDT = 100 积分</span>
              </button>

              {selectedPkgId === 'custom' && (
                <div className="mt-2 flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold">$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={customUsdt}
                      onChange={(e) => setCustomUsdt(e.target.value)}
                      placeholder="输入 USDT 充值数量"
                      className="w-full pl-8 pr-4 py-2 bg-slate-950 border border-amber-500/50 rounded-xl text-white text-xs focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div className="text-xs font-semibold text-amber-400 px-3 py-2 bg-slate-800 rounded-xl border border-slate-700 whitespace-nowrap">
                    兑换: {calculateCredits().toLocaleString()} 积分
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 收款地址与二维码 */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                USDT 充值地址
              </span>
              <span className="text-[11px] text-amber-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 官方地址
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="w-24 h-24 bg-white p-1.5 rounded-xl shrink-0 flex items-center justify-center shadow">
                <img 
                  src={currentWallet.qrCodePlaceholder} 
                  alt="USDT Deposit QR" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-slate-900 rounded-lg border border-slate-700 text-xs font-mono text-slate-200 break-all select-all">
                    {currentWallet.address}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-600 transition-colors flex items-center gap-1 shrink-0 text-xs cursor-pointer"
                    title="复制收款地址"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 提交充值 */}
          <form onSubmit={handleSubmitRecharge} className="space-y-3.5">
            {/* 价格明细摘要 */}
            <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/60 flex items-center justify-between text-xs">
              <div className="text-slate-400">
                充值: <strong className="text-white">${getUsdtAmount()} USDT</strong>
              </div>
              <div className="text-slate-400">
                预计到账: <strong className="text-amber-400 text-sm">+{calculateCredits().toLocaleString()} 积分</strong>
              </div>
            </div>

            <button
              id="btn-confirm-recharge-submit"
              type="submit"
              disabled={loading || getUsdtAmount() <= 0}
              className="w-full py-3 px-4 bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-bold rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs cursor-pointer"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>正在处理充值...</span>
                </div>
              ) : (
                <>
                  <Coins className="w-4 h-4" />
                  <span>确认充值 ${getUsdtAmount()} USDT</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
