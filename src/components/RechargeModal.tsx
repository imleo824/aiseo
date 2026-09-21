import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Coins, Copy, ShieldCheck, X, RefreshCw, AlertCircle, ArrowRight } from 'lucide-react';
import { ApiService } from '../services/api';
import type { CustomPaymentPricing, TenantAccount, UsdtPackage } from '../types/seo';
import { decimalToMicros, formatDecimal, microsToDecimal } from '../lib/fixedDecimal';

type PaymentIntent = {
  id: string;
  packageId: string | null;
  pricingSource: 'PACKAGE' | 'CUSTOM';
  network: 'TRC20';
  recipientAddress: string;
  baseAmountUsdt: string;
  expectedAmountUsdt: string;
  creditMicros: string;
  status: string;
  expiresAt: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  account: TenantAccount | null;
  tenantId: string;
  initialConfig?: Awaited<ReturnType<ApiService['getCreditConfig']>>;
};

export const RechargeModal: React.FC<Props> = ({ isOpen, onClose, account, tenantId, initialConfig }) => {
  const api = useMemo(() => new ApiService(tenantId), [tenantId]);
  const intentRequestId = useRef(0);
  const [packages, setPackages] = useState<UsdtPackage[]>([]);
  const [customPricing, setCustomPricing] = useState<CustomPaymentPricing | null>(null);
  const [selectionMode, setSelectionMode] = useState<'PACKAGE' | 'CUSTOM'>('PACKAGE');
  const [customAmount, setCustomAmount] = useState('');
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

  const createIntent = useCallback(async (input: { packageId: string } | { customAmountMicros: string }) => {
    const requestId = ++intentRequestId.current;
    setLoadingIntent(true);
    setIntent(null);
    setError(null);
    try {
      const newIntent = await api.createPaymentIntent(input);
      if (requestId === intentRequestId.current) setIntent(newIntent);
    } catch (requestError) {
      if (requestId === intentRequestId.current) {
        setError(requestError instanceof Error ? requestError.message : '获取充值订单失败，请稍后重试');
      }
    } finally {
      if (requestId === intentRequestId.current) setLoadingIntent(false);
    }
  }, [api]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIntent(null);
    setPackages([]);
    setCustomPricing(null);
    setSelectionMode('PACKAGE');
    setCustomAmount('');
    setSelectedPkgId('');
    setTxHash('');
    setError(null);
    setSuccess(null);
    setLoadingPackages(true);
    setLoadingIntent(false);

    const preparePayment = async () => {
      try {
        const result = initialConfig || await api.getCreditConfig();
        if (cancelled) return;
        setPackages(result.packages);
        setCustomPricing(result.customPricing);
        const defaultPackageId = result.packages[0]?.id || '';
        setSelectedPkgId(defaultPackageId);
      } catch (requestError) {
        if (cancelled) return;
        setError(requestError instanceof Error ? requestError.message : '充值套餐加载失败');
      } finally {
        if (!cancelled) setLoadingPackages(false);
      }
    };

    void preparePayment();
    return () => {
      cancelled = true;
      intentRequestId.current += 1;
    };
  }, [api, initialConfig, isOpen]);

  const resetPaymentDetails = () => {
    intentRequestId.current += 1;
    setIntent(null);
    setTxHash('');
    setError(null);
    setSuccess(null);
    setLoadingIntent(false);
  };

  const handleSelectPackage = (pkgId: string) => {
    if ((selectionMode === 'PACKAGE' && pkgId === selectedPkgId) || loadingIntent) return;
    setSelectionMode('PACKAGE');
    setSelectedPkgId(pkgId);
    resetPaymentDetails();
  };

  const handleSelectCustom = () => {
    if (loadingIntent || selectionMode === 'CUSTOM') return;
    setSelectionMode('CUSTOM');
    resetPaymentDetails();
  };

  const customAmountMicros = useMemo(() => {
    if (!/^[1-9]\d*$/.test(customAmount)) return null;
    try { return decimalToMicros(customAmount); } catch { return null; }
  }, [customAmount]);

  const customAmountValid = useMemo(() => {
    if (!customPricing?.active || !customAmountMicros) return false;
    const amount = BigInt(customAmountMicros);
    return amount >= BigInt(decimalToMicros(customPricing.minUsdt))
      && amount <= BigInt(decimalToMicros(customPricing.maxUsdt));
  }, [customAmountMicros, customPricing]);

  const customCreditEstimate = useMemo(() => {
    if (!customAmountValid || !customAmountMicros || !customPricing) return '';
    const credits = BigInt(customAmountMicros) * BigInt(decimalToMicros(customPricing.creditsPerUsdt)) / 1_000_000n;
    return microsToDecimal(credits);
  }, [customAmountMicros, customAmountValid, customPricing]);

  const handleCreateIntent = async () => {
    if (selectionMode === 'PACKAGE') {
      if (!selectedPkgId) return;
      await createIntent({ packageId: selectedPkgId });
      return;
    }
    if (!customAmountValid || !customAmountMicros) {
      setError(`请输入 ${customPricing?.minUsdt || '—'}–${customPricing?.maxUsdt || '—'} 之间的整数 USDT 金额`);
      return;
    }
    await createIntent({ customAmountMicros });
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
      await api.submitPaymentTransaction(intent.id, cleanHash);
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

  const expectedAmount = intent?.expectedAmountUsdt || '';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="recharge-dialog-title"
        className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-950 text-white grid place-items-center shadow-xs">
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 id="recharge-dialog-title" className="text-base font-bold text-slate-900">USDT 充值</h3>
              <p className="text-xs text-slate-500">
                当前可用：<b className="text-slate-900 font-mono font-bold">{formatDecimal(account?.credits || '0')}</b> 积分
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
              <span className="text-xs font-bold text-slate-900">1. 选择套餐或自定义金额</span>
              {loadingPackages && (
                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> 正在加载…
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {packages.map((pkg) => {
                const isSelected = selectionMode === 'PACKAGE' && selectedPkgId === pkg.id;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => handleSelectPackage(pkg.id)}
                    disabled={loadingIntent}
                    className={`p-3 rounded-xl border text-left transition relative cursor-pointer min-h-[64px] disabled:cursor-wait disabled:opacity-70 ${
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
                      {formatDecimal(pkg.usdtAmount)} <span className="text-xs font-bold">USDT</span>
                    </div>
                    <div className={`text-[11px] font-medium mt-0.5 ${isSelected ? 'text-emerald-300' : 'text-slate-600'}`}>
                      {formatDecimal(pkg.credits)} 积分
                    </div>
                  </button>
                );
              })}
              {customPricing?.active && (
                <button
                  type="button"
                  onClick={handleSelectCustom}
                  disabled={loadingIntent}
                  className={`p-3 rounded-xl border text-left transition relative cursor-pointer min-h-[64px] disabled:cursor-wait disabled:opacity-70 ${
                    selectionMode === 'CUSTOM'
                      ? 'bg-slate-950 text-white border-slate-950 shadow-xs ring-2 ring-slate-950/20'
                      : 'bg-slate-50 hover:bg-slate-100/90 text-slate-900 border-slate-200/90'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-semibold ${selectionMode === 'CUSTOM' ? 'text-slate-300' : 'text-slate-500'}`}>自定义金额</span>
                    {selectionMode === 'CUSTOM' && (
                      <span className="w-4 h-4 rounded-full bg-emerald-500 text-white grid place-items-center">
                        <Check className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-black">自行输入 USDT</div>
                  <div className={`text-[11px] mt-0.5 ${selectionMode === 'CUSTOM' ? 'text-emerald-300' : 'text-slate-600'}`}>
                    {formatDecimal(customPricing.minUsdt)}–{formatDecimal(customPricing.maxUsdt)} USDT
                  </div>
                </button>
              )}
            </div>

            {selectionMode === 'CUSTOM' && customPricing?.active && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                <label htmlFor="custom-usdt-amount" className="text-[11px] font-bold text-slate-700">自定义充值金额（整数 USDT）</label>
                <div className="flex items-center gap-2">
                  <input
                    id="custom-usdt-amount"
                    type="text"
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    value={customAmount}
                    onChange={(event) => {
                      setCustomAmount(event.target.value.replace(/\D/g, ''));
                      resetPaymentDetails();
                    }}
                    placeholder={`最低 ${formatDecimal(customPricing.minUsdt)} USDT`}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-sm font-bold text-slate-950 outline-none focus:ring-2 focus:ring-slate-950/20"
                  />
                  <span className="text-xs font-bold text-slate-600">USDT</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  每 1 USDT 到账 {formatDecimal(customPricing.creditsPerUsdt)} 积分
                  {customCreditEstimate ? `，预计到账 ${formatDecimal(customCreditEstimate)} 积分` : ''}
                </p>
              </div>
            )}

            {!loadingPackages && packages.length === 0 && !customPricing?.active && !error && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                当前没有可用充值方式，请联系平台支持。
              </div>
            )}
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
                <p className="text-xs text-slate-500 font-medium">正在准备 TRC20 收款地址与精确金额…</p>
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
                  <p className="flex items-start gap-1.5 text-[11px] text-rose-600 font-medium pt-0.5">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>请务必转账上述包含小数点的精确金额。金额不一致时系统不会自动入账，需联系人工支持处理。</span>
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
              <button
                type="button"
                onClick={() => void handleCreateIntent()}
                disabled={loadingPackages || (selectionMode === 'PACKAGE' ? !selected : !customAmountValid)}
                className="w-full min-h-[44px] rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                确认金额并查看充值信息
              </button>
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
                    <span>提交交易哈希并等待核验</span>
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
