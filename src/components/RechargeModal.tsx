import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Check, Coins, Copy, ShieldCheck, X, RefreshCw, AlertCircle, ArrowRight } from 'lucide-react';
import { ApiService } from '../services/api';
import type { TenantAccount, UsdtPackage } from '../types/seo';

type PaymentIntent = {
  id: string;
  packageId: string;
  recipientAddress: string;
  expectedAmountMicros: string;
  creditMicros: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  account: TenantAccount | null;
  tenantId: string;
};

export const RechargeModal: React.FC<Props> = ({ isOpen, onClose, account, tenantId }) => {
  const [packages, setPackages] = useState<UsdtPackage[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [txHash, setTxHash] = useState('');
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [loadingIntent, setLoadingIntent] = useState(false);
  const [submittingHash, setSubmittingHash] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = useMemo(() => packages.find(({ id }) => id === selectedPkgId), [packages, selectedPkgId]);

  const loadIntentForPackage = useCallback(async (packageId: string) => {
    if (!packageId) return;
    setLoadingIntent(true);
    setError(null);
    try {
      const api = new ApiService(tenantId);
      const newIntent = await api.createPaymentIntent(packageId);
      setIntent(newIntent);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '获取充值订单失败，请稍后重试');
    } finally {
      setLoadingIntent(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!isOpen) return;
    setIntent(null);
    setTxHash('');
    setError(null);
    setSuccess(null);
    setLoadingPackages(true);

    const api = new ApiService(tenantId);
    api.getCreditConfig()
      .then(async (result) => {
        setPackages(result.packages);
        const defaultPkg = result.packages[0];
        if (defaultPkg) {
          setSelectedPkgId(defaultPkg.id);
          // Directly open and create payment intent so the user doesn't have to click a second time
          await loadIntentForPackage(defaultPkg.id);
        }
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : '充值套餐加载失败');
      })
      .finally(() => {
        setLoadingPackages(false);
      });
  }, [isOpen, tenantId, loadIntentForPackage]);

  const handleSelectPackage = async (pkgId: string) => {
    if (pkgId === selectedPkgId && intent) return;
    setSelectedPkgId(pkgId);
    setSuccess(null);
    await loadIntentForPackage(pkgId);
  };

  const submitHash = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanHash = txHash.trim();
    if (!intent || !/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
      setError('请输入有效的 TRON 主网 64 位十六进制交易哈希 (TxHash)');
      return;
    }
    setSubmittingHash(true);
    setError(null);
    try {
      await new ApiService(tenantId).submitPaymentTransaction(intent.id, cleanHash);
      setSuccess('交易已提交至链上核验引擎。系统将校验 TRC20 合约转账、收款地址与精确金额，核验通过后积分自动入账。');
      setTxHash('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '交易提交失败，请核对哈希是否正确');
    } finally {
      setSubmittingHash(false);
    }
  };

  const copyAddress = async () => {
    if (!intent) return;
    await navigator.clipboard.writeText(intent.recipientAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const copyAmount = async () => {
    if (!expectedAmount) return;
    await navigator.clipboard.writeText(expectedAmount);
    setCopiedAmount(true);
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  const expectedAmount = intent ? (Number(BigInt(intent.expectedAmountMicros)) / 1_000_000).toFixed(6) : '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-950 text-white grid place-items-center shadow-xs">
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">USDT 极速充值</h3>
              <p className="text-xs text-slate-500">
                当前可用：<b className="text-slate-900 font-mono font-bold">{account?.credits || 0}</b> 积分
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="关闭充值面板"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5">
          {error && (
            <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {success && (
            <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2 leading-relaxed">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {/* 1. Package selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">1. 选择充值套餐 (点击即刻切换)</span>
              {loadingPackages && (
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 正在加载…
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {packages.map((pkg) => {
                const isSelected = selectedPkgId === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => void handleSelectPackage(pkg.id)}
                    className={`p-3 rounded-xl border text-left transition relative cursor-pointer min-h-[64px] ${
                      isSelected
                        ? 'bg-slate-950 text-white border-slate-950 shadow-xs ring-2 ring-slate-950/20'
                        : 'bg-slate-50 hover:bg-slate-100/90 text-slate-900 border-slate-200/90'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-semibold truncate ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {pkg.name}
                      </span>
                      {isSelected && (
                        <span className="w-4 h-4 rounded-full bg-emerald-500 text-white grid place-items-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="text-base sm:text-lg font-black font-mono mt-0.5">
                      {pkg.usdtAmount} <span className="text-xs font-bold">USDT</span>
                    </div>
                    <div className={`text-[11px] font-medium mt-0.5 ${isSelected ? 'text-emerald-300' : 'text-slate-600'}`}>
                      {pkg.credits.toLocaleString()} 积分
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Direct payment details panel */}
          <div className="space-y-3 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">2. 按链上精确金额转账</span>
              <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                <ShieldCheck className="w-3.5 h-3.5" />
                TRC20 主网
              </span>
            </div>

            {loadingIntent ? (
              <div className="py-8 text-center space-y-2 bg-white rounded-xl border border-slate-200/90">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-500 font-medium">正在生成专属订单收款地址与精确金额…</p>
              </div>
            ) : intent ? (
              <>
                {/* Exact Amount Card */}
                <div className="rounded-xl bg-white border border-slate-200/90 p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>精确应付金额 (含唯一对账微额)</span>
                    <button
                      type="button"
                      onClick={() => void copyAmount()}
                      className="text-slate-700 hover:text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      {copiedAmount ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedAmount ? '已复制金额' : '复制金额'}</span>
                    </button>
                  </div>
                  <div className="text-xl sm:text-2xl font-black font-mono text-slate-950 flex items-baseline gap-1.5">
                    <span>{expectedAmount}</span>
                    <span className="text-xs font-bold text-slate-500">USDT</span>
                  </div>
                  <p className="text-[11px] text-rose-600 font-medium pt-0.5">
                    ⚠️ 请务必转账上述包含小数点的精确金额，切勿转整数，否则无法自动上分。
                  </p>
                </div>

                {/* Recipient Address Card */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-600">TRC20 收款地址</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-2.5 bg-white rounded-xl border border-slate-200/90 text-xs font-mono break-all text-slate-800 select-all">
                      {intent.recipientAddress}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyAddress()}
                      className="px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold shrink-0 min-h-[42px] flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95 transition"
                    >
                      {copiedAddress ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedAddress ? '已复制' : '复制地址'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>订单有效窗口：30 分钟</span>
                  <span>截止：{new Date(intent.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
              </>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500 bg-white rounded-xl border border-slate-200/90">
                请先选择充值套餐以生成收款信息
              </div>
            )}
          </div>

          {/* 3. TxHash form */}
          {intent && (
            <form onSubmit={submitHash} className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label htmlFor="tron-hash" className="block text-xs font-bold text-slate-900">
                  3. 转账完成后，填入 64 位交易哈希 (TxHash)
                </label>
              </div>
              <input
                id="tron-hash"
                value={txHash}
                onChange={(event) => setTxHash(event.target.value)}
                placeholder="例如: 8a5d3f... (64位 TRON 交易哈希)"
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200/90 rounded-xl text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/20"
              />
              <button
                type="submit"
                disabled={submittingHash || !txHash.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-950 text-white hover:bg-slate-800 active:bg-slate-900 text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs min-h-[42px]"
              >
                {submittingHash ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>正在链上核验…</span>
                  </>
                ) : (
                  <>
                    <span>提交链上核验并上分</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
