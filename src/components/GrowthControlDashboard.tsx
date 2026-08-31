import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Check,
  CirclePause,
  Database,
  Globe2,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  WandSparkles
} from 'lucide-react';
import type { GrowthStatus } from '../types/api';
import type { WordPressSite } from '../types/seo';

interface GrowthControlDashboardProps {
  sites: WordPressSite[];
  onGetGrowthStatus: (siteId: string) => Promise<GrowthStatus>;
  onStartGrowth: (siteId: string) => Promise<GrowthStatus>;
  onPauseGrowth: (siteId: string) => Promise<GrowthStatus>;
  onOpenOnboarding?: () => void;
}

const stageOrder = ['REALITY', 'OPPORTUNITY', 'DECISION', 'EXECUTION', 'LEARNING'] as const;
const stageLabels: Record<(typeof stageOrder)[number], { title: string; detail: string }> = {
  REALITY: { title: '真实现状', detail: 'GSC 快照与数据水位' },
  OPPORTUNITY: { title: '增长机会', detail: '业务相关性与流量空间' },
  DECISION: { title: '系统决策', detail: '收益、概率、成本与风险' },
  EXECUTION: { title: '最小动作', detail: '原子化、可回滚、受权限约束' },
  LEARNING: { title: '观察学习', detail: '增量效果与冷却期' }
};

const stateCopy: Record<NonNullable<GrowthStatus['state']>['status'], { title: string; description: string; tone: string }> = {
  NEEDS_BASELINE: { title: '等待建立基线', description: '启动后将先同步真实搜索数据。', tone: 'text-slate-700 bg-slate-100' },
  BASELINING: { title: '正在建立真实基线', description: '系统正在同步 GSC，不会用默认值填充指标。', tone: 'text-indigo-700 bg-indigo-50' },
  ACTIVE: { title: '持续增长中', description: '新的真实数据到达后，系统会自动进入下一轮决策。', tone: 'text-emerald-700 bg-emerald-50' },
  OBSERVING: { title: '正在观察效果', description: '冷却期内不重复修改同一目标，等待足够数据后再学习。', tone: 'text-cyan-700 bg-cyan-50' },
  PAUSED: { title: '增长已暂停', description: '已停止新的决策与执行，历史证据保留。', tone: 'text-amber-700 bg-amber-50' },
  BLOCKED: { title: '增长被安全门禁阻止', description: '修复真实数据或执行条件后可重新启动。', tone: 'text-rose-700 bg-rose-50' }
};

const opportunityLabels: Record<string, string> = {
  RANK_11_20: '临界排名提升',
  HIGH_IMPRESSION_LOW_CTR: '高曝光低点击修复',
  CONTENT_DECAY: '内容衰退恢复'
};

const actionLabels: Record<string, string> = {
  UPDATE_TITLE: '优化标题',
  CONTENT_REFRESH: '更新现有内容',
  DIAGNOSE_ONLY: '仅做诊断',
  ADD_INTERNAL_LINKS: '增加内链',
  ADD_CONTENT_SECTION: '增补内容段落',
  FIX_INDEXABILITY: '修复可索引性',
  CREATE_CONTENT: '创建新内容'
};

const actionStatusLabels: Record<string, string> = {
  PLANNED: '已规划', REVIEW_REQUIRED: '等待审核', APPROVED: '已批准', EXECUTING: '执行中',
  VERIFYING: '验证中', OBSERVING: '观察中', SUCCEEDED: '已完成', FAILED: '执行失败',
  ROLLED_BACK: '已回滚', CANCELLED: '安全阻止'
};

const formatMicros = (value?: string | null): string => {
  if (value == null) return '未计算';
  try {
    const micros = BigInt(value);
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, '0').slice(0, 2).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole.toString();
  } catch {
    return '未计算';
  }
};

const formatDate = (value?: string | null): string => value
  ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '未采集';

const readPlanQuery = (plan: Record<string, unknown>): string | undefined => typeof plan.query === 'string' ? plan.query : undefined;

export const GrowthControlDashboard: React.FC<GrowthControlDashboardProps> = ({
  sites,
  onGetGrowthStatus,
  onStartGrowth,
  onPauseGrowth,
  onOpenOnboarding
}) => {
  const [selectedSiteId, setSelectedSiteId] = useState(() => sites[0]?.id || '');
  const [status, setStatus] = useState<GrowthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [operating, setOperating] = useState<'start' | 'pause' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!sites.some((site) => site.id === selectedSiteId)) setSelectedSiteId(sites[0]?.id || '');
  }, [selectedSiteId, sites]);

  const loadStatus = useCallback(async (showLoading = true) => {
    if (!selectedSiteId) {
      setStatus(null);
      return;
    }
    const sequence = ++requestSequence.current;
    if (showLoading) setLoading(true);
    try {
      const next = await onGetGrowthStatus(selectedSiteId);
      if (sequence === requestSequence.current) {
        setStatus(next);
        setError(null);
      }
    } catch (caught) {
      if (sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : '无法读取增长状态');
    } finally {
      if (sequence === requestSequence.current && showLoading) setLoading(false);
    }
  }, [onGetGrowthStatus, selectedSiteId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const latestCycle = status?.cycles[0];
  const shouldPoll = status?.state?.status === 'BASELINING'
    || latestCycle?.status === 'QUEUED'
    || latestCycle?.status === 'RUNNING'
    || latestCycle?.status === 'OBSERVING';

  useEffect(() => {
    if (!shouldPoll) return;
    const interval = window.setInterval(() => void loadStatus(false), 5_000);
    return () => window.clearInterval(interval);
  }, [loadStatus, shouldPoll]);

  const selectedSite = useMemo(() => sites.find((site) => site.id === selectedSiteId), [selectedSiteId, sites]);
  const state = status?.state;
  const currentStateCopy = state ? stateCopy[state.status] : {
    title: '尚未启动',
    description: '系统将基于真实搜索数据持续发现、执行并验证增长机会。',
    tone: 'text-slate-700 bg-slate-100'
  };
  const isRunning = state && ['BASELINING', 'ACTIVE', 'OBSERVING'].includes(state.status);

  const perform = async (kind: 'start' | 'pause') => {
    if (!selectedSiteId || operating) return;
    setOperating(kind);
    setError(null);
    try {
      const next = kind === 'start' ? await onStartGrowth(selectedSiteId) : await onPauseGrowth(selectedSiteId);
      setStatus(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setOperating(null);
    }
  };

  if (!sites.length) return (
    <section className="bg-white border border-slate-200/80 rounded-2xl p-8 sm:p-12 shadow-sm text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-950 text-emerald-400 grid place-items-center mx-auto mb-4"><Globe2 className="w-6 h-6" /></div>
      <h2 className="text-xl font-extrabold text-slate-950">先连接一个 WordPress 站点</h2>
      <p className="mt-2 text-sm text-slate-500">站点是真实搜索数据、业务知识和增长动作的边界。</p>
      <button type="button" onClick={onOpenOnboarding} className="mt-6 px-5 py-2.5 rounded-xl bg-slate-950 text-white text-sm font-bold hover:bg-slate-800 transition">添加站点</button>
    </section>
  );

  const cycleStageIndex = latestCycle ? stageOrder.indexOf(latestCycle.stage as (typeof stageOrder)[number]) : -1;
  const completedThrough = latestCycle?.status === 'SUCCEEDED' ? cycleStageIndex : cycleStageIndex - 1;
  const hasExecutedAction = Boolean(status?.actions.some((action) => action.status === 'SUCCEEDED'));
  const hasLearnedOutcome = status?.metrics.attributionStatus === 'AVAILABLE';

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-200">
      <section className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-slate-950 text-white grid place-items-center text-sm">1</span>
              选择站点
            </label>
            <button type="button" onClick={onOpenOnboarding} className="text-xs sm:text-[13px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition">+ 添加站点</button>
          </div>
          <div className="relative">
            <Globe2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)} className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200">
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.domain}</option>)}
            </select>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-slate-950 text-white grid place-items-center text-sm font-bold">2</span>
                <h2 className="text-lg font-extrabold text-slate-950">搜索增长引擎</h2>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${currentStateCopy.tone}`}>{currentStateCopy.title}</span>
              </div>
              <p className="mt-2 ml-9 text-sm text-slate-500 max-w-2xl">{currentStateCopy.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button type="button" onClick={() => void loadStatus()} disabled={loading} className="w-10 h-10 rounded-xl border border-slate-200 text-slate-600 grid place-items-center hover:bg-slate-50 disabled:opacity-50" aria-label="刷新真实状态">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {isRunning ? (
                <button type="button" onClick={() => void perform('pause')} disabled={operating !== null} className="h-10 px-4 rounded-xl border border-slate-300 bg-white text-slate-800 text-sm font-bold flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
                  {operating === 'pause' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CirclePause className="w-4 h-4" />}
                  暂停增长
                </button>
              ) : (
                <button type="button" onClick={() => void perform('start')} disabled={operating !== null || loading || status?.readiness.canStart === false} className="h-11 px-5 rounded-xl bg-slate-950 text-white text-sm font-extrabold flex items-center gap-2 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed shadow-sm">
                  {operating === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  开始增长
                </button>
              )}
            </div>
          </div>

          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span></div>}

          {status && (
            <div className="grid sm:grid-cols-3 gap-2.5">
              {[
                { ok: status.readiness.gscReady, label: 'GSC 真实数据', detail: '启动必需' },
                { ok: status.readiness.knowledgeReady, label: '业务知识来源', detail: '启动必需' },
                { ok: status.readiness.wordpressReady, label: 'WordPress 执行器', detail: '未连接时仅观察' }
              ].map((gate) => (
                <div key={gate.label} className={`rounded-xl border px-3.5 py-3 flex items-center gap-3 ${gate.ok ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50'}`}>
                  <span className={`w-7 h-7 rounded-lg grid place-items-center ${gate.ok ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-400'}`}>{gate.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}</span>
                  <div><div className="text-xs font-bold text-slate-900">{gate.label}</div><div className="text-[10px] text-slate-500 mt-0.5">{gate.ok ? '已验证' : gate.detail}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-extrabold text-slate-950 flex items-center gap-2"><WandSparkles className="w-4 h-4 text-indigo-600" />增长决策链</div>
            <div className="text-[11px] text-slate-400">Reality → Opportunity → Decision → Execution → Learning</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
            {stageOrder.map((stage, index) => {
              const complete = index <= completedThrough
                || (stage === 'EXECUTION' && hasExecutedAction)
                || (stage === 'LEARNING' && hasLearnedOutcome);
              const active = !complete && ((index === cycleStageIndex && ['QUEUED', 'RUNNING', 'OBSERVING'].includes(latestCycle?.status || ''))
                || (!latestCycle && stage === 'REALITY' && state?.status === 'BASELINING'));
              const failed = index === cycleStageIndex && latestCycle?.status === 'FAILED';
              return (
                <div key={stage} className={`rounded-xl border p-3 min-h-[96px] ${complete ? 'border-emerald-200 bg-emerald-50/50' : active ? 'border-indigo-300 bg-indigo-50/70' : failed ? 'border-rose-200 bg-rose-50/70' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`w-7 h-7 rounded-lg grid place-items-center text-xs font-bold ${complete ? 'bg-emerald-600 text-white' : active ? 'bg-indigo-600 text-white' : failed ? 'bg-rose-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>{complete ? <Check className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : index + 1}</span>
                    {active && <span className="text-[9px] font-bold text-indigo-600">进行中</span>}
                  </div>
                  <div className="mt-2 text-xs font-extrabold text-slate-900">{stageLabels[stage].title}</div>
                  <div className="mt-1 text-[10px] leading-4 text-slate-500">{stageLabels[stage].detail}</div>
                </div>
              );
            })}
          </div>
          {latestCycle?.errorMessage && <p className="mt-3 text-xs text-rose-700">本轮阻止原因：{latestCycle.errorMessage}</p>}
        </div>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: <Search className="w-4 h-4" />, label: '自然搜索点击', value: status?.metrics.organicClicks == null ? '未采集' : status.metrics.organicClicks.toLocaleString(), foot: status?.metrics.source === 'GSC' ? `GSC · ${formatDate(status.metrics.collectedAt)}` : '等待 GSC 快照' },
          { icon: <Activity className="w-4 h-4" />, label: '周期变化', value: status?.metrics.organicClickChangePct == null ? '数据不足' : `${status.metrics.organicClickChangePct >= 0 ? '+' : ''}${status.metrics.organicClickChangePct.toFixed(1)}%`, foot: '仅对比两个真实快照' },
          { icon: <Target className="w-4 h-4" />, label: '待评估机会', value: status ? status.opportunities.length.toString() : '—', foot: '已通过业务相关性门禁' },
          { icon: <BarChart3 className="w-4 h-4" />, label: '经验证增量点击', value: status?.metrics.attributionStatus === 'AVAILABLE' ? formatMicros(status.metrics.attributedLiftMicros) : '观察不足', foot: '不将总流量冒充为系统贡献' }
        ].map((metric) => (
          <div key={metric.label} className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500"><span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 grid place-items-center">{metric.icon}</span>{metric.label}</div>
            <div className="mt-3 text-xl font-extrabold text-slate-950 font-mono">{loading ? '…' : metric.value}</div>
            <div className="mt-1 text-[10px] text-slate-400">{metric.foot}</div>
          </div>
        ))}
      </section>

      <section className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-extrabold text-slate-950 flex items-center gap-2"><Sparkles className="w-4 h-4 text-emerald-600" />优先增长机会</h3><span className="text-[10px] text-slate-400">确定性评分</span></div>
          <div className="space-y-2.5">
            {!status?.opportunities.length && <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-8 text-center text-xs text-slate-500">启动并完成真实数据分析后，合格机会才会出现。</div>}
            {status?.opportunities.slice(0, 5).map((opportunity, index) => (
              <article key={opportunity.id} className="rounded-xl border border-slate-200 p-3.5 flex gap-3">
                <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-950 text-white grid place-items-center text-xs font-bold">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3"><h4 className="text-xs font-extrabold text-slate-900 line-clamp-2">{opportunity.title}</h4><span className="text-[10px] font-bold text-emerald-700 whitespace-nowrap">+预期 {formatMicros(opportunity.expectedValueMicros)}</span></div>
                  <div className="mt-1.5 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1"><span>{opportunityLabels[opportunity.type] || opportunity.type}</span>{opportunity.targetUrl && <span className="truncate max-w-[240px]">{opportunity.targetUrl}</span>}</div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-extrabold text-slate-950 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-indigo-600" />最近决策与动作</h3><span className="text-[10px] text-slate-400">风险分级 · 可追溯</span></div>
          <div className="space-y-2.5">
            {!status?.actions.length && <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-8 text-center text-xs text-slate-500">系统只会在有足够证据时创建动作。</div>}
            {status?.actions.slice(0, 5).map((action) => {
              const query = readPlanQuery(action.plan);
              return (
                <article key={action.id} className="rounded-xl border border-slate-200 p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h4 className="text-xs font-extrabold text-slate-900">{actionLabels[action.type] || action.type}</h4><p className="mt-1 text-[10px] text-slate-500 truncate">{query || action.targetUrl || '系统诊断动作'}</p></div>
                    <div className="flex items-center gap-1.5 shrink-0"><span className="px-2 py-1 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600">风险 {action.riskLevel}</span><span className={`px-2 py-1 rounded-md text-[9px] font-bold ${action.status === 'SUCCEEDED' ? 'bg-emerald-50 text-emerald-700' : action.status === 'CANCELLED' || action.status === 'FAILED' ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700'}`}>{actionStatusLabels[action.status] || action.status}</span></div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <div className="flex items-start gap-2 text-[11px] text-slate-500 px-1"><Database className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>当前站点：{selectedSite?.domain}。所有指标都带数据源与采集时间；缺少真实证据时显示“未采集”，不生成合成数值。</span><ArrowUpRight className="w-3.5 h-3.5 shrink-0" /></div>
    </div>
  );
};
