import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  Coins,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  QrCode
} from 'lucide-react';
import { ActionPricingItem, UsdtPackage, TenantAccount } from '../types/seo';
import { ApiService } from '../services/api';

interface ProPricingConfigTabProps {
  account: TenantAccount | null;
  tenantId: string;
  onConfigSaved?: () => void;
}

export const ProPricingConfigTab: React.FC<ProPricingConfigTabProps> = ({
  account,
  tenantId,
  onConfigSaved
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states
  const [actionPricing, setActionPricing] = useState<ActionPricingItem[]>([]);
  const [packages, setPackages] = useState<UsdtPackage[]>([]);
  const [activeTab, setActiveTab] = useState<'ACTION_PRICING' | 'PACKAGES' | 'GLOBAL'>('ACTION_PRICING');

  const isAdmin = account?.role === 'ADMIN';

  useEffect(() => {
    loadConfig();
  }, [tenantId]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const api = new ApiService(tenantId);
      const res = await api.getCreditConfig();
      if (res.actionPricing) {
        setActionPricing(res.actionPricing.map(item => ({
          action: item.action,
          name: item.name || item.action,
          credits: item.credits,
          desc: item.desc,
          enabled: item.enabled !== false
        })));
      }
      if (res.packages) {
        setPackages(res.packages);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载定价配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!isAdmin) {
      setError('仅系统管理员可以修改定价与套餐配置');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const api = new ApiService(tenantId);
      const res = await api.updatePricingConfig({
        actionPricing,
        packages
      });

      setSuccessMsg(res.message || '定价与套餐配置已成功保存生效！');
      if (onConfigSaved) onConfigSaved();
      setTimeout(() => {
        setSuccessMsg(null);
      }, 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存配置失败');
    } finally {
      setSaving(false);
    }
  };


  const handleUpdateActionCredits = (index: number, credits: number) => {
    const next = [...actionPricing];
    next[index] = { ...next[index], credits: Math.max(0, credits) };
    setActionPricing(next);
  };

  const handleUpdateActionDesc = (index: number, desc: string) => {
    const next = [...actionPricing];
    next[index] = { ...next[index], desc };
    setActionPricing(next);
  };

  const handleUpdateActionName = (index: number, name: string) => {
    const next = [...actionPricing];
    next[index] = { ...next[index], name };
    setActionPricing(next);
  };

  const handleUpdatePackage = <K extends keyof UsdtPackage>(index: number, field: K, val: UsdtPackage[K]) => {
    const next = [...packages];
    next[index] = { ...next[index], [field]: val };
    setPackages(next);
  };

  const handleAddPackage = () => {
    const newId = `pkg-custom-${Date.now()}`;
    setPackages([
      ...packages,
      {
        id: newId,
        name: '新特惠套餐',
        badge: '特惠活动',
        usdtAmount: 200,
        credits: 24000,
        bonusCredits: 4000,
        popular: false
      }
    ]);
  };

  const handleRemovePackage = (index: number) => {
    const next = [...packages];
    next.splice(index, 1);
    setPackages(next);
  };

  return (
    <div className="w-full space-y-4 sm:space-y-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-4 sm:space-y-6">

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="bg-slate-50/70 rounded-2xl overflow-hidden border border-slate-200/90 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200/80 bg-white p-2.5 sm:p-3 gap-3">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide bg-slate-100/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('ACTION_PRICING')}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap min-h-[36px] cursor-pointer ${
                activeTab === 'ACTION_PRICING'
                  ? 'bg-white text-slate-950 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <Coins className="w-3.5 h-3.5 text-amber-500" />
              <span>1. 核心收费标准 ({actionPricing.length} 项)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('PACKAGES')}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap min-h-[36px] cursor-pointer ${
                activeTab === 'PACKAGES'
                  ? 'bg-white text-slate-950 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
              <span>2. USDT 充值套餐 ({packages.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('GLOBAL')}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all whitespace-nowrap min-h-[36px] cursor-pointer ${
                activeTab === 'GLOBAL'
                  ? 'bg-white text-slate-950 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-950'
              }`}
            >
              <QrCode className="w-3.5 h-3.5 text-blue-500" />
              <span>3. 收款安全配置</span>
            </button>
          </div>

          {isAdmin && (
            <div className="flex justify-end shrink-0">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading}
                className="px-4 py-2 text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white rounded-xl flex items-center gap-1.5 shadow-2xs transition disabled:opacity-50 cursor-pointer whitespace-nowrap min-h-[38px]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? '正在保存...' : '保存配置'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="py-24 text-center space-y-3">
              <div className="w-9 h-9 border-2 border-slate-950 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-xs text-slate-500">正在获取最新全局定价策略...</p>
            </div>
          ) : (
            <>
              {activeTab === 'ACTION_PRICING' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3">
                    {actionPricing.map((item, idx) => (
                      <div
                        key={item.action}
                        className={`p-4 rounded-xl border transition-all ${
                          item.enabled !== false
                            ? 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                            : 'bg-slate-50/50 border-slate-200/60 opacity-60'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                          <div className="flex-1 space-y-1.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0"></span>
                              <input
                                type="text"
                                disabled={!isAdmin}
                                value={item.name}
                                onChange={(e) => handleUpdateActionName(idx, e.target.value)}
                                className="bg-slate-50/80 border border-slate-200/90 px-3 py-1 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-slate-400 w-52 md:w-64 disabled:opacity-100 disabled:bg-transparent disabled:border-transparent disabled:px-0 font-sans shrink-0 min-h-[32px]"
                              />
                              <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200/70 shrink-0 font-bold">
                                {item.action}
                              </span>
                            </div>

                            <div className="w-full">
                              <input
                                type="text"
                                disabled={!isAdmin}
                                value={item.desc}
                                onChange={(e) => handleUpdateActionDesc(idx, e.target.value)}
                                placeholder="功能详细说明与消耗说明"
                                className="w-full bg-transparent border-b border-dashed border-slate-200/90 focus:border-slate-400 text-xs text-slate-600 py-1 focus:outline-none disabled:border-transparent"
                              />
                            </div>
                          </div>

                          {/* Credits input */}
                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            <div className="flex items-center gap-1.5 bg-slate-50/80 border border-slate-200/90 rounded-xl px-3 py-1.5 min-h-[38px]">
                              <span className="text-xs font-semibold text-slate-600">扣除单价:</span>
                              <input
                                type="number"
                                min="0"
                                max="1000"
                                disabled={!isAdmin}
                                value={item.credits}
                                onChange={(e) => handleUpdateActionCredits(idx, parseInt(e.target.value) || 0)}
                                className="w-12 bg-transparent text-xs font-black text-rose-600 text-right focus:outline-none disabled:opacity-100 font-mono"
                              />
                              <span className="text-xs font-bold text-slate-800">积分</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'PACKAGES' && (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex flex-col sm:flex-row justify-between sm:items-center gap-3 shadow-2xs">
                    <div>
                      <h4 className="text-xs font-bold text-slate-950">USDT 购买/充值优惠套餐</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        前台充值面板将直接呈现下列梯度套餐。管理员可动态更改充值金额、到账额度与加赠比例，并设定推荐状态。
                      </p>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={handleAddPackage}
                        className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition self-start sm:self-center shadow-2xs min-h-[36px] cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5 text-emerald-400" />
                        <span>添加套餐</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {packages.map((pkg, idx) => (
                      <div
                        key={pkg.id || idx}
                        className={`p-4 rounded-xl border transition-all relative ${
                          pkg.popular
                            ? 'bg-blue-50/20 border-blue-300 ring-1 ring-blue-200 shadow-2xs'
                            : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-3.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <input
                              type="text"
                              disabled={!isAdmin}
                              value={pkg.name}
                              onChange={(e) => handleUpdatePackage(idx, 'name', e.target.value)}
                              className="bg-slate-50/80 border border-slate-200/90 px-2.5 py-1 rounded-lg text-xs font-bold text-slate-950 focus:bg-white focus:outline-none focus:border-slate-400 w-28 disabled:bg-transparent disabled:border-transparent disabled:px-0"
                              placeholder="套餐名称"
                            />
                            <input
                              type="text"
                              disabled={!isAdmin}
                              value={pkg.badge || ''}
                              onChange={(e) => handleUpdatePackage(idx, 'badge', e.target.value)}
                              className="bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-lg text-[10px] text-emerald-800 font-bold focus:bg-white focus:outline-none focus:border-emerald-400 w-24 disabled:bg-emerald-50 disabled:border-emerald-200/80"
                              placeholder="优惠角标"
                            />
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <label className="flex items-center gap-1 text-[11px] text-slate-600 font-semibold cursor-pointer select-none">
                              <input
                                type="checkbox"
                                disabled={!isAdmin}
                                checked={!!pkg.popular}
                                onChange={(e) => handleUpdatePackage(idx, 'popular', e.target.checked)}
                                className="rounded border-slate-300 text-slate-950 focus:ring-0 w-3.5 h-3.5 cursor-pointer"
                              />
                              <span>推荐</span>
                            </label>

                            {isAdmin && packages.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemovePackage(idx)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                title="删除此套餐"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2.5 bg-slate-50/80 p-3 rounded-xl border border-slate-200/80 text-xs">
                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold">支付 (USDT)</div>
                            <div className="flex items-center gap-0.5 mt-1">
                              <span className="text-slate-500 font-bold">$</span>
                              <input
                                type="number"
                                min="1"
                                disabled={!isAdmin}
                                value={pkg.usdtAmount}
                                onChange={(e) => handleUpdatePackage(idx, 'usdtAmount', parseFloat(e.target.value) || 0)}
                                className="w-full bg-transparent font-bold text-slate-950 focus:outline-none font-mono"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold">到账积分</div>
                            <input
                              type="number"
                              min="0"
                              disabled={!isAdmin}
                              value={pkg.credits}
                              onChange={(e) => handleUpdatePackage(idx, 'credits', parseInt(e.target.value) || 0)}
                              className="w-full bg-transparent font-bold text-slate-950 focus:outline-none mt-1 font-mono"
                            />
                          </div>

                          <div>
                            <div className="text-[10px] text-slate-500 font-semibold">加赠积分</div>
                            <input
                              type="number"
                              min="0"
                              disabled={!isAdmin}
                              value={pkg.bonusCredits || 0}
                              onChange={(e) => handleUpdatePackage(idx, 'bonusCredits', parseInt(e.target.value) || 0)}
                              className="w-full bg-transparent font-bold text-emerald-600 focus:outline-none mt-1 font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'GLOBAL' && (
                <div className="space-y-4">
                  <div className="p-5 rounded-xl bg-white border border-slate-200/90 space-y-4 shadow-2xs">
                    <div className="rounded-xl border border-blue-200/90 bg-blue-50/70 p-4 text-xs leading-relaxed text-blue-950 font-medium">
                      TRC20 收款地址、USDT 合约与 TronGrid 密钥由部署平台 Secret 管理，不允许从浏览器读取或修改。客户创建充值订单后，系统会从服务端返回唯一六位小数应付金额和正式收款地址。
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
