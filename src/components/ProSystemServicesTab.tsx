import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { createApiService } from '../services/api';

type ProviderStatus = Record<string, boolean | string | number | null | undefined>;

export const ProSystemServicesTab: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [providers, setProviders] = useState<ProviderStatus>({});
  const [requireManualConfirmation, setRequireManualConfirmation] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const service = createApiService(tenantId);
      const [result, publishingPolicy] = await Promise.all([
        service.getProviderStatus(),
        service.getPublishingConfirmationPolicy()
      ]);
      setProviders(result.providers);
      setRequireManualConfirmation(publishingPolicy.requireManualConfirmation);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '服务状态加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [tenantId]);

  const updatePublishingPolicy = async () => {
    if (requireManualConfirmation === null || savingPolicy) return;
    const next = !requireManualConfirmation;
    setSavingPolicy(true);
    setError(null);
    try {
      const saved = await createApiService(tenantId).updatePublishingConfirmationPolicy(next);
      setRequireManualConfirmation(saved.requireManualConfirmation);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '发布确认策略保存失败');
    } finally {
      setSavingPolicy(false);
    }
  };

  const entries = Object.entries(providers);
  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4" />发布确认策略</h3>
            <p className="text-xs text-slate-500 mt-1">这是全平台唯一开关，对全部客户站点与手动、定时任务同时生效。</p>
            <p className="text-xs font-medium mt-2 text-slate-700">{requireManualConfirmation ? '开启：内容通过质量门禁后，等待人工确认再发布。' : '关闭：内容通过全部质量与安全门禁后，自动发布到 WordPress。'}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={requireManualConfirmation === true}
            onClick={() => void updatePublishingPolicy()}
            disabled={loading || savingPolicy || requireManualConfirmation === null}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${requireManualConfirmation ? 'bg-violet-600' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${requireManualConfirmation ? 'translate-x-6' : 'translate-x-1'}`} />
            <span className="sr-only">发布前需人工确认</span>
          </button>
        </div>
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div><h3 className="font-bold text-slate-900 flex items-center gap-2"><Activity className="w-4 h-4" />生产服务状态</h3><p className="text-xs text-slate-500 mt-1">密钥由部署平台 Secret 管理，浏览器只读取非敏感配置状态。</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />刷新</button>
        </div>
        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>}
        {loading ? <div className="py-16 text-center text-xs text-slate-500">正在读取部署状态…</div> : entries.length === 0 ? <div className="py-16 text-center text-xs text-slate-500">未返回供应商状态。</div> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{entries.map(([name, value]) => {
            const configured = value === true || value === 'configured' || value === 'CONNECTED';
            return <div key={name} className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3"><div><div className="text-xs font-bold text-slate-900">{name}</div><div className="text-[11px] text-slate-500 mt-1">{configured ? '部署密钥已配置' : '尚未配置，相关功能将失败关闭'}</div></div><span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 ${configured ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{configured ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}{configured ? '可用' : '缺失'}</span></div>;
          })}</div>
        )}
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2"><ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" /><span>OpenAI/Gemini、DataForSEO、TronGrid、SMTP、Turnstile 和 Sentry 密钥不会通过 API 返回，也不能在此页面修改。</span></div>
      </div>
    </div>
  );
};
