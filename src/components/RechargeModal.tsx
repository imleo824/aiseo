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
  const [txHash, setTxHash] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [packages, setPackages] = useState<UsdtPackage[]>([]);
  const [wallets, setWallets] = useState<Record<string, { network: string; address: string; qrCodePlaceholder: string }>>({});
  const [paymentAvailable, setPaymentAvailable] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('正在读取支付服务状态…');

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      const api = new ApiService(tenantId);
      api.getCreditConfig().then(res => {
        if (res.packages) setPackages(res.packages);
        if (res.wallets) setWallets(res.wallets);
        setPaymentAvailable(res.paymentAvailable);
        setPaymentNotice(res.paymentNotice || (res.paymentAvailable ? '' : '支付服务暂不可用'));
      }).catch(() => {
        setPaymentAvailable(false);
        setPaymentNotice('无法读取支付服务状态，请稍后重试。');
      });
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
    if (!paymentAvailable || !currentWallet) {
      setError(paymentNotice || '支付服务尚未配置');
      return;
    }
    if (amount <= 0) {
      setError('请选择充值套餐或输入有效的 USDT 金额');
      return;
    }
    if (!/^[a-fA-F0-9]{64}$/.test(txHash.trim())) {
      setError('请输入 TRON 主网 64 位交易哈希；提交后将进入链上核验。');
      return;
    }

    setLoading(true);
    try {
      const res = await onRechargeSuccess(
        amount, 
        txHash.trim(),
        'TRC20', 
        selectedPkgId !== 'custom' ? selectedPkgId : undefined
      );
      setSuccessMsg(res?.message || '交易哈希已提交，等待链上核验；核验前不会入账。');
    } catch (err: any) {
      setError(err?.message || '充值处理失败，请检查网络后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        id="recharge-modal-card" 
        className="relative w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-950 text-white flex items-center justify-center shadow-xs">
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">USDT 充值兑换积分</h3>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200 rounded-md">
                  1 USDT = 100 积分
                </span>
              </div>
              <p className="text-xs text-slate-500">
                当前可用余额: <span className="font-bold text-slate-900 font-mono">{account?.credits ?? 0}</span> 积分
              </p>
            </div>
          </div>
          <button 
            id="btn-close-recharge-modal"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1 text-sm">
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2.5">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-bold">{successMsg}</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2.5">
              <X className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="text-xs font-bold">{error}</span>
            </div>
          )}

          {/* 1. 选择充值套餐 */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-900">
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
                    className={`relative p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-950 text-white border-slate-950 shadow-sm ring-1 ring-slate-950'
                        : 'bg-slate-50/80 hover:bg-slate-100 text-slate-900 border-slate-200'
                    }`}
                  >
                    {pkg.popular && (
                      <span className={`absolute -top-2 right-2 px-2 py-0.5 text-[10px] font-bold rounded-full shadow-xs ${
                        isSelected ? 'bg-white text-slate-950' : 'bg-slate-900 text-white'
                      }`}>
                        推荐
                      </span>
                    )}
                    <div className={`text-xs font-semibold ${isSelected ? 'text-slate-300' : 'text-slate-500'} mb-1`}>
                      {pkg.name}
                    </div>
                    <div className="text-lg font-black font-mono mb-1">
                      ${pkg.usdtAmount} <span className="text-xs font-normal">USDT</span>
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-bold ${
                      isSelected ? 'text-slate-200' : 'text-slate-700'
                    }`}>
                      <Coins className="w-3.5 h-3.5 opacity-80" />
                      <span>{pkg.credits.toLocaleString()} 积分</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 自定义金额 */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setSelectedPkgId('custom')}
                className={`w-full p-3 rounded-xl border text-left text-xs font-bold flex items-center justify-between transition ${
                  selectedPkgId === 'custom'
                    ? 'bg-slate-950 text-white border-slate-950'
                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                }`}
              >
                <span>自定义 USDT 充值数量</span>
                <span className={selectedPkgId === 'custom' ? 'text-slate-300' : 'text-slate-500 font-mono'}>
                  1 USDT = 100 积分
                </span>
              </button>

              {selectedPkgId === 'custom' && (
                <div className="mt-2.5 flex items-center gap-2.5">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={customUsdt}
                      onChange={(e) => setCustomUsdt(e.target.value)}
                      placeholder="输入 USDT 数量"
                      className="w-full pl-8 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-xs font-medium focus:bg-white focus:outline-none focus:border-slate-400 transition"
                    />
                  </div>
                  <div className="text-xs font-bold text-slate-900 px-4 py-2.5 bg-slate-100 rounded-xl border border-slate-200 whitespace-nowrap">
                    到账: {calculateCredits().toLocaleString()} 积分
                  </div>
                </div>
              )}
            </div>
          </div>

          {!paymentAvailable || !currentWallet ? (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs leading-6 text-amber-900">
              <strong className="block text-amber-950">支付服务尚未开放</strong>
              {paymentNotice}
            </div>
          ) : <>
          {/* 收款地址与二维码 */}
          <div className="p-4 rounded-xl bg-slate-50/70 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">
                USDT 收款地址 (TRC20 网络)
              </span>
              <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>官方收款地址</span>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="w-24 h-24 bg-white p-1.5 rounded-xl shrink-0 flex items-center justify-center shadow-xs border border-slate-200">
                <img 
                  src={currentWallet.qrCodePlaceholder} 
                  alt="USDT Deposit QR" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-white rounded-xl border border-slate-200 shadow-xs text-xs font-mono text-slate-800 break-all select-all">
                    {currentWallet.address}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyAddress}
                    className="p-2.5 bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition flex items-center gap-1 shrink-0 text-xs font-bold cursor-pointer"
                    title="复制收款地址"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 提交充值 */}
          <form onSubmit={handleSubmitRecharge} className="space-y-3 pt-1">
            {/* 价格明细摘要 */}
            <div className="p-3.5 bg-slate-50/70 rounded-xl flex items-center justify-between text-xs">
              <div className="text-slate-600">
                充值: <strong className="text-slate-900 font-mono">${getUsdtAmount()} USDT</strong>
              </div>
              <div className="text-slate-600">
                核验后到账: <strong className="text-slate-900 font-bold text-sm">+{calculateCredits().toLocaleString()} 积分</strong>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="tron-transaction-hash" className="block text-xs font-bold text-slate-900">TRON 交易哈希</label>
              <input
                id="tron-transaction-hash"
                value={txHash}
                onChange={(event) => setTxHash(event.target.value)}
                placeholder="粘贴 64 位交易哈希"
                autoComplete="off"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
              />
              <p className="text-[11px] leading-5 text-slate-500">仅支持 TRC20；提交哈希不等于入账，系统将在已固化交易中核验收款地址、合约和金额。</p>
            </div>

            <button
              id="btn-confirm-recharge-submit"
              type="submit"
              disabled={loading || !paymentAvailable || !currentWallet || getUsdtAmount() <= 0}
              className="w-full py-3.5 px-4 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm active:scale-[0.99] cursor-pointer"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>正在提交核验…</span>
                </div>
              ) : (
                <>
                  <Coins className="w-4 h-4 text-emerald-400" />
                  <span>提交交易哈希核验</span>
                </>
              )}
            </button>
          </form>
          </>}
        </div>
      </div>
    </div>
  );
};
