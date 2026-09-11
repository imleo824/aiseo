import React, { useEffect, useState } from 'react';
import { Activity, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { createApiService } from '../services/api';

type ProviderStatus = Record<string, boolean | string | number | null | undefined>;

const PROVIDER_METADATA: Record<string, { title: string; desc: string; category: string }> = {
  workerOnline: {
    title: '后台异步任务工作节点 (Worker Engine)',
    desc: '负责长任务执行、SERP 关键词数据拉取、自动文章生成与 WordPress 队列发布',
    category: '核心运行时'
  },
  contentAi: {
    title: 'AI 创作与 SEO 润色引擎 (Gemini / OpenAI)',
    desc: '负责深度长文生成、EEAT 专业维度对齐、Schema 结构化标记与内链锚点建议',
    category: '内容智能'
  },
  dataForSeo: {
    title: 'SEO 真实检索数据源 (DataForSEO)',
    desc: '负责 Google SERP 排名监测、真实搜索量预估、CPC 与关键词竞品分析',
    category: 'SEO 数据'
  },
  gsc: {
    title: 'Google Search Console (GSC)',
    desc: '负责官方站长平台数据集成、收录索引状态追踪与搜索流量回读',
    category: 'Google 站长'
  },
  trc20Payments: {
    title: 'USDT (TRC-20) 链上自动化充值网关',
    desc: '负责区块链交易哈希自动核验、防重放保护与积分实时入账',
    category: '支付网关'
  }
};

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
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <h3 className="font-bold text-slate-950 text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <span>发布确认策略</span>
            </h3>
            <p className="text-xs text-slate-500">这是全平台唯一开关，对全部客户站点与手动、定时任务同时生效。</p>
            <p className="text-xs font-semibold text-slate-700 pt-0.5">
              {requireManualConfirmation ? '已开启：文章生成后，需在「内容审核」中手动确认才发布。' : '已关闭：文章生成后，将自动发布到您的 WordPress 网站。'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={requireManualConfirmation === true}
            onClick={() => void updatePublishingPolicy()}
            disabled={loading || savingPolicy || requireManualConfirmation === null}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 cursor-pointer ${requireManualConfirmation ? 'bg-slate-950' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${requireManualConfirmation ? 'translate-x-6' : 'translate-x-1'}`} />
            <span className="sr-only">发布前需人工确认</span>
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h3 className="font-bold text-slate-950 text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-600" />
              <span>生产服务状态</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">密钥由部署平台 Secret 管理，浏览器只读取非敏感配置状态。</p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 rounded-xl text-xs font-bold text-slate-800 flex items-center gap-1.5 disabled:opacity-50 transition min-h-[38px] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>

        {error && <div className="rounded-xl border border-rose-200/90 bg-rose-50 p-3.5 text-xs text-rose-800 font-medium">{error}</div>}

        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-8 h-8 border-2 border-slate-950 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-500 font-medium">正在读取部署状态…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-500 font-medium">未返回供应商状态。</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entries.map(([name, value]) => {
              const configured = value === true || value === 'configured' || value === 'CONNECTED';
              const meta = PROVIDER_METADATA[name] || {
                title: name,
                desc: configured ? '部署环境变量与密钥已生效' : '尚未配置，相关功能将失败关闭',
                category: '系统模块'
              };
              return (
                <div
                  key={name}
                  className="rounded-xl border border-slate-200/90 p-4.5 flex flex-col justify-between gap-3 bg-slate-50/60 shadow-2xs hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-950">{meta.title}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200/70 text-slate-700">
                          {meta.category}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium leading-relaxed">
                        {meta.desc}
                      </div>
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border flex items-center gap-1 shrink-0 ${
                      configured ? 'bg-emerald-50 text-emerald-800 border-emerald-200/80' : 'bg-rose-50 text-rose-800 border-rose-200/80'
                    }`}>
                      {configured ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="w-3.5 h-3.5 text-rose-600" />}
                      <span>{configured ? '可用' : '未就绪'}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-blue-200/80 bg-blue-50/70 p-3.5 text-xs text-blue-950 font-medium flex items-start gap-2.5 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          <span>OpenAI/Gemini、DataForSEO、TronGrid、SMTP、Turnstile 和 Sentry 密钥不会通过 API 返回，也不能在此页面修改。</span>
        </div>
      </div>
    </div>
  );
};
