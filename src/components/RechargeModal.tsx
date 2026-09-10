import React, { useEffect, useMemo, useState } from 'react';
import { Check, Coins, Copy, ShieldCheck, X } from 'lucide-react';
import { ApiService } from '../services/api';
import type { TenantAccount, UsdtPackage } from '../types/seo';

type PaymentIntent = { id: string; packageId: string; recipientAddress: string; expectedAmountMicros: string; creditMicros: string; status: string; expiresAt: string; createdAt: string };

type Props = { isOpen: boolean; onClose: () => void; account: TenantAccount | null; tenantId: string };

export const RechargeModal: React.FC<Props> = ({ isOpen, onClose, account, tenantId }) => {
  const [packages, setPackages] = useState<UsdtPackage[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const selected = useMemo(() => packages.find(({ id }) => id === selectedPkgId), [packages, selectedPkgId]);

  useEffect(() => {
    if (!isOpen) return;
    setIntent(null); setTxHash(''); setError(null); setSuccess(null);
    const api = new ApiService(tenantId);
    api.getCreditConfig().then((result) => {
      setPackages(result.packages);
      setSelectedPkgId(result.packages[0]?.id || '');
    }).catch((requestError) => setError(requestError instanceof Error ? requestError.message : '充值套餐加载失败'));
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  const createIntent = async () => {
    if (!selectedPkgId) return;
    setLoading(true); setError(null); setSuccess(null);
    try { setIntent(await new ApiService(tenantId).createPaymentIntent(selectedPkgId)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : '充值订单创建失败'); }
    finally { setLoading(false); }
  };

  const submitHash = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!intent || !/^[a-fA-F0-9]{64}$/.test(txHash.trim())) { setError('请输入 TRON 主网 64 位交易哈希'); return; }
    setLoading(true); setError(null);
    try {
      await new ApiService(tenantId).submitPaymentTransaction(intent.id, txHash.trim());
      setSuccess('交易已进入链上核验。只有合约、地址、精确金额和时间窗口全部匹配后才会入账。');
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : '交易提交失败'); }
    finally { setLoading(false); }
  };

  const copyAddress = async () => { if (!intent) return; await navigator.clipboard.writeText(intent.recipientAddress); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const expectedAmount = intent ? (Number(BigInt(intent.expectedAmountMicros)) / 1_000_000).toFixed(6) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-slate-200/90 rounded-2xl shadow-xl overflow-hidden max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-950 text-white grid place-items-center">
              <Coins className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">TRC20 USDT 充值</h3>
              <p className="text-xs text-slate-500">
                当前余额：<b className="text-slate-900 font-mono font-semibold">{account?.credits || 0}</b> 积分
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {error && (
            <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2 leading-relaxed">
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <div className="space-y-2.5">
            <div className="text-xs font-bold text-slate-900">1. 选择充值套餐</div>
            <div className="grid grid-cols-2 gap-2.5">
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  disabled={Boolean(intent)}
                  onClick={() => setSelectedPkgId(pkg.id)}
                  className={`p-3.5 rounded-xl border text-left transition active:scale-[0.98] cursor-pointer min-h-[72px] ${
                    selectedPkgId === pkg.id
                      ? 'bg-slate-950 text-white border-slate-950 shadow-xs'
                      : 'bg-slate-50 hover:bg-slate-100/80 text-slate-900 border-slate-200/90'
                  }`}
                >
                  <div className="text-xs opacity-75">{pkg.name}</div>
                  <div className="text-base sm:text-lg font-black font-mono mt-0.5">{pkg.usdtAmount} USDT</div>
                  <div className="text-xs font-semibold mt-0.5 opacity-90">{pkg.credits.toLocaleString()} 积分</div>
                </button>
              ))}
            </div>
          </div>

          {!intent ? (
            <button
              type="button"
              onClick={() => void createIntent()}
              disabled={loading || !selected}
              className="btn-primary w-full min-h-[44px]"
            >
              {loading ? '正在创建订单…' : '创建唯一金额充值订单'}
            </button>
          ) : (
            <>
              <div className="space-y-3 rounded-xl border border-slate-200/90 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">2. 按精确金额转账</span>
                  <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    TRC20 主网
                  </span>
                </div>
                <div className="rounded-xl bg-white border border-slate-200/90 p-3.5 space-y-1">
                  <div className="text-[11px] text-slate-500">精确应付金额</div>
                  <div className="text-xl sm:text-2xl font-black font-mono text-slate-950">{expectedAmount} USDT</div>
                  <p className="text-[11px] text-rose-700 pt-0.5">必须精确到 6 位小数，不要按套餐整数金额转账。</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2.5 bg-white rounded-xl border border-slate-200/90 text-xs font-mono break-all text-slate-800">
                    {intent.recipientAddress}
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyAddress()}
                    className="btn-primary min-h-[44px] px-3.5 text-xs shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? '已复制' : '复制'}</span>
                  </button>
                </div>
                <div className="text-[11px] text-slate-500">
                  订单有效期至 {new Date(intent.expiresAt).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </div>

              <form onSubmit={submitHash} className="space-y-2.5">
                <label htmlFor="tron-hash" className="block text-xs font-bold text-slate-900">
                  3. 转账后提交交易哈希
                </label>
                <input
                  id="tron-hash"
                  value={txHash}
                  onChange={(event) => setTxHash(event.target.value)}
                  placeholder="64 位 TRON TxHash"
                  className="input-field font-mono text-xs"
                />
                <button
                  type="submit"
                  disabled={loading || Boolean(success)}
                  className="btn-primary w-full min-h-[44px]"
                >
                  {loading ? '提交中…' : '提交链上核验'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
