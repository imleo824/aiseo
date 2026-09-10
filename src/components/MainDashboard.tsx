import React, { useState, useMemo, useCallback } from 'react';
import {
  WordPressSite,
  ArticleDraft,
  AUTOMATION_PIPELINE_STAGES,
  PipelineStepStates,
  PipelineStepStatus
} from '../types/seo';
import type { GrowthInput, GrowthStatus } from '../types/api';
import { PipelineVisualizer } from './dashboard/PipelineVisualizer';
import { DraftPreviewModal } from './dashboard/DraftPreviewModal';
import { CompetitorAnalysisSection } from './dashboard/CompetitorAnalysisSection';
import {
  Zap,
  CheckCircle2,
  Globe,
  Sparkles,
  AlertCircle,
  Swords,
  ExternalLink,
  Eye,
  ArrowRight,
  Repeat,
  KeyRound,
  Link2,
  Search
} from 'lucide-react';

interface MainDashboardProps {
  sites: WordPressSite[];
  drafts: ArticleDraft[];
  growthStatuses?: Record<string, GrowthStatus>;
  onRollback?: (draftId: string) => Promise<void>;
  onStartGrowthProgram: (
    siteIds: string[],
    addLog: (msg: string) => void,
    setPipelineStep: (step: number, status: PipelineStepStatus) => void,
    inputs?: GrowthInput[]
  ) => Promise<ArticleDraft | undefined>;
  onOpenOnboarding?: () => void;
}

const initialPipelineStepStates = (): PipelineStepStates => Object.fromEntries(
  AUTOMATION_PIPELINE_STAGES.map(({ number }) => [number, 'PENDING'])
) as PipelineStepStates;

const splitKeywordSignals = (value: string): string[] => value
  .split(/[\n,，;；]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const splitUrlSignals = (value: string): string[] => value
  .split(/[\s,，;；]+/)
  .map((item) => item.trim())
  .filter(Boolean);

export const MainDashboard: React.FC<MainDashboardProps> = ({
  sites = [],
  drafts = [],
  growthStatuses = {},
  onRollback,
  onStartGrowthProgram,
  onOpenOnboarding
}) => {
  const safeSites = useMemo(() => sites || [], [sites]);
  const safeDrafts = useMemo(() => drafts || [], [drafts]);

  // 第 1 步：选站点
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => safeSites[0]?.id || '');

  React.useEffect(() => {
    if (safeSites.length > 0 && (!selectedSiteId || !safeSites.some(s => s.id === selectedSiteId))) {
      setSelectedSiteId(safeSites[0].id);
    }
  }, [safeSites, selectedSiteId]);

  // 三种增长线索：关键词、参考文章、竞品站点。
  const [mode, setMode] = useState<'KEYWORD' | 'REWRITE' | 'COMPETITOR'>('KEYWORD');
  const [keywordInput, setKeywordInput] = useState<string>('');
  const [rewriteInput, setRewriteInput] = useState<string>('');

  // 竞品攻防
  const [competitorInput, setCompetitorInput] = useState<string>('');

  // 执行状态
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activePipelineStep, setActivePipelineStep] = useState<number | null>(null);
  const [pipelineStepStates, setPipelineStepStates] = useState<PipelineStepStates>(initialPipelineStepStates);
  const [executionLogs, setExecutionLogs] = useState<string[]>([]);

  // 最新生成成功的文章卡片高亮展示（直达结果）
  const [latestPublishedDraft, setLatestPublishedDraft] = useState<ArticleDraft | null>(null);

  // 预览模态框与提示
  const [previewDraft, setPreviewDraft] = useState<ArticleDraft | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const activeSite = useMemo(() => {
    return safeSites.find(s => s.id === selectedSiteId) || safeSites[0];
  }, [safeSites, selectedSiteId]);
  const persistedGrowthStatus = selectedSiteId ? growthStatuses[selectedSiteId] : undefined;
  const persistedRunActive = Boolean(persistedGrowthStatus?.run && ['QUEUED', 'RUNNING'].includes(persistedGrowthStatus.run.status));
  const executionActive = isRunning || persistedRunActive;

  const setPipelineStep = useCallback((step: number, status: PipelineStepStatus) => {
    setPipelineStepStates((previous) => ({ ...previous, [step]: status }));
    setActivePipelineStep((previous) => {
      if (status === 'RUNNING') return step;
      return previous === step ? null : previous;
    });
  }, []);

  React.useEffect(() => {
    const run = persistedGrowthStatus?.run;
    if (!run) return;
    const stageNumbers = { UNDERSTAND: 1, DISCOVER: 2, DECIDE: 3, EXECUTE: 4, LEARN: 5 } as const;
    const states = initialPipelineStepStates();
    for (const stage of persistedGrowthStatus.stages) {
      states[stageNumbers[stage.stage]] = stage.status === 'BLOCKED' || stage.status === 'FAILED'
        ? 'FAILED'
        : stage.status;
    }
    setPipelineStepStates(states);
    const runningStage = persistedGrowthStatus.stages.find(({ status }) => status === 'RUNNING');
    setActivePipelineStep(runningStage ? stageNumbers[runningStage.stage] : null);
    setIsRunning(run.status === 'QUEUED' || run.status === 'RUNNING');
    setExecutionLogs(persistedGrowthStatus.stages.flatMap((stage) => stage.summary ? [
      `[${stage.startedAt ? new Date(stage.startedAt).toLocaleTimeString() : '--:--:--'}] [${stageNumbers[stage.stage]}/5 ${stage.stage}] ${stage.summary}`
    ] : []));
    if (run.draftId) {
      const delivered = safeDrafts.find(({ id }) => id === run.draftId && persistedGrowthStatus.run?.status === 'DELIVERED');
      if (delivered?.status === 'PUBLISHED') setLatestPublishedDraft(delivered);
    }
  }, [persistedGrowthStatus, safeDrafts]);

  // 最近生成的文章列表
  const recentArticles = useMemo(() => {
    return safeDrafts.slice(0, 5);
  }, [safeDrafts]);
  const actionByDraftId = useMemo(() => new Map(
    Object.values(growthStatuses).flatMap((status) => status.run?.draftId && status.action
      ? [[status.run.draftId, status.action] as const]
      : [])
  ), [growthStatuses]);
  const actionLabel = (type?: string): string => ({
    CREATE_CONTENT: '新建内容',
    UPDATE_TITLE: '优化标题',
    ADD_CONTENT_SECTION: '增补内容',
    CONTENT_REFRESH: '更新旧页面',
    ADD_INTERNAL_LINKS: '添加内链',
    DIAGNOSE_ONLY: '安全诊断'
  }[type || ''] || '站点增长动作');

  // 傻瓜式一键执行（无论是常规词还是竞品词）
  const handleExecuteGenerateAndPublish = async (overrideKeyword?: string) => {
    if (persistedRunActive) {
      showToast('当前站点已有增长任务在执行，请先查看实时进度');
      return;
    }
    const targetSiteId = selectedSiteId || safeSites[0]?.id;
    if (!targetSiteId && safeSites.length === 0) {
      showToast('请先配置目标站点');
      return;
    }

    let inputs: GrowthInput[];

    if (overrideKeyword?.trim()) {
      inputs = [{ type: 'KEYWORD', value: overrideKeyword.trim() }];
    } else {
      inputs = [
        ...splitKeywordSignals(keywordInput).map((value): GrowthInput => ({ type: 'KEYWORD', value })),
        ...splitUrlSignals(rewriteInput).map((value): GrowthInput => ({ type: 'REFERENCE_URL', value })),
        ...splitUrlSignals(competitorInput).map((value): GrowthInput => ({ type: 'COMPETITOR_SITE', value }))
      ];
    }
    const targetSiteIds = targetSiteId ? [targetSiteId] : safeSites.map(s => s.id);

    setIsRunning(true);
    setExecutionLogs([]);
    setPipelineStepStates(initialPipelineStepStates());
    setLatestPublishedDraft(null);

    const addLog = (msg: string) => {
      setExecutionLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    let acceptedByServer = false;
    try {
      const publishedDraft = await onStartGrowthProgram(targetSiteIds, addLog, setPipelineStep, inputs);
      acceptedByServer = true;
      if (publishedDraft?.status === 'PUBLISHED') {
        setLatestPublishedDraft(publishedDraft);
      }
      showToast(publishedDraft?.status === 'PUBLISHED'
        ? '内容已发布'
        : publishedDraft?.status === 'QUALITY_FAILED'
          ? '内容未通过质量门禁，未修改站点且未扣费'
          : publishedDraft
            ? '交付草稿已生成，请到“我的内容”审核发布'
            : '增长程序已进入后台队列，可刷新页面或稍后回来继续查看');
    } catch (e: unknown) {
      addLog(`[执行异常] ${e instanceof Error ? e.message : String(e)}`);
      setPipelineStepStates((previous) => {
        const failedStates = { ...previous };
        for (const step of Object.keys(failedStates)) {
          if (failedStates[Number(step)] === 'RUNNING') {
            failedStates[Number(step)] = 'FAILED';
          }
        }
        return failedStates;
      });
      showToast(e instanceof Error ? e.message : '执行失败，请查看任务日志');
    } finally {
      if (!acceptedByServer) {
        setIsRunning(false);
        setActivePipelineStep(null);
      }
    }
  };

  const handleRollback = async (draftId: string) => {
    if (!onRollback) return;
    try {
      await onRollback(draftId);
      showToast('文章已下线');
      if (previewDraft?.id === draftId) setPreviewDraft(null);
      if (latestPublishedDraft?.id === draftId) setLatestPublishedDraft(null);
    } catch {
      showToast('操作失败');
    }
  };

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-xl flex items-center space-x-2 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 核心操作主卡片 */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-2xs space-y-6">

        {/* 步骤 1 & 2 & 3 表单 */}
        <div className="space-y-6">

          {/* 第一步：选择发布站点 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center text-xs sm:text-sm font-bold shadow-2xs">1</span>
                <span>选择站点</span>
              </label>

              {safeSites.length > 0 && onOpenOnboarding && (
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="text-xs sm:text-[13px] font-bold text-slate-800 hover:text-slate-950 bg-slate-100 hover:bg-slate-200/80 active:bg-slate-200 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer min-h-[36px]"
                >
                  <span>+ 添加站点</span>
                </button>
              )}
            </div>

            {safeSites.length === 0 ? (
              <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200/90 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>暂未绑定站点，请先接入目标 WordPress 网站。</span>
                </div>
                {onOpenOnboarding && (
                  <button
                    type="button"
                    onClick={onOpenOnboarding}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold text-xs rounded-xl shadow-2xs transition shrink-0 cursor-pointer min-h-[38px]"
                  >
                    + 接入 WordPress 站点
                  </button>
                )}
              </div>
            ) : (
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Globe className="w-4 h-4 text-slate-500" />
                </div>
                <select
                  value={selectedSiteId || (safeSites.length > 0 ? safeSites[0].id : '')}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/80 hover:bg-slate-100/80 border border-slate-200/90 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition cursor-pointer appearance-none shadow-2xs min-h-[42px]"
                >
                  {safeSites.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            )}
            {activeSite?.connectorStatus === 'CONNECTED' && (
              <p className="text-[11px] font-medium text-slate-500">
                {activeSite.wordpressCompatibilityMode === 'FULL_AUTO' ? 'WordPress：可自动执行'
                  : activeSite.wordpressCompatibilityMode === 'SAFE_AUTO' ? 'WordPress：系统将自动选择安全动作'
                    : activeSite.wordpressCompatibilityMode === 'ANALYSIS_ONLY' ? 'WordPress：仅支持分析，不会写入或扣费'
                      : activeSite.wordpressCompatibilityMode === 'BLOCKED' ? 'WordPress：连接或权限不可用'
                        : 'WordPress：开始前将自动检测兼容能力'}
              </p>
            )}
          </div>

          {/* 第二步：设定发文主题 */}
          <div className="space-y-3 pt-1">
            <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center text-xs sm:text-sm font-bold shadow-2xs">2</span>
              <span>选择主题</span>
            </label>

            {/* 3 种模式切换 Tab */}
            <div className="grid grid-cols-3 p-1 bg-slate-100/90 rounded-xl gap-1 border border-slate-200/70">
              <button
                type="button"
                onClick={() => setMode('KEYWORD')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer min-h-[42px] ${
                  mode === 'KEYWORD'
                    ? 'bg-white text-slate-950 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">自定义关键词</span>
                <span className="inline sm:hidden">关键词</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('REWRITE')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer min-h-[42px] ${
                  mode === 'REWRITE'
                    ? 'bg-white text-slate-950 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
                }`}
              >
                <Repeat className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">参考文章</span>
                <span className="inline sm:hidden">参考</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('COMPETITOR')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer min-h-[42px] ${
                  mode === 'COMPETITOR'
                    ? 'bg-white text-slate-950 shadow-2xs font-bold'
                    : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
                }`}
              >
                <Swords className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">对标竞品</span>
                <span className="inline sm:hidden">对标竞品</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500 px-1 font-medium">
              三类线索可组合且支持多个值；全部留空时，系统会从已连接站点自动发现机会。
            </p>

            {/* 模式 1：自定义关键词 */}
            {mode === 'KEYWORD' && (
              <div className="space-y-2.5 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/90 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-slate-500" />
                    输入核心关键词或主题
                  </span>
                </div>
                <div className="relative">
                  <textarea
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder={'例如：\n企业级高可用架构\n云原生容灾方案'}
                    rows={3}
                    className="w-full resize-none px-3.5 py-2.5 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs"
                  />
                  {keywordInput && (
                    <button
                      type="button"
                      onClick={() => setKeywordInput('')}
                      className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md cursor-pointer"
                    >
                      清空
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 模式 2：参考文章只用于提取事实、结构和信息缺口 */}
            {mode === 'REWRITE' && (
              <div className="space-y-2.5 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/90 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-slate-500" />
                    输入参考文章 URL
                  </span>
                </div>
                <div className="relative">
                  <textarea
                    value={rewriteInput}
                    onChange={(e) => setRewriteInput(e.target.value)}
                    placeholder={'每行一个完整地址，例如：\nhttps://example.com/article-a\nhttps://example.com/article-b'}
                    rows={3}
                    className="w-full resize-none px-3.5 py-2.5 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs"
                  />
                  {rewriteInput && (
                    <button
                      type="button"
                      onClick={() => setRewriteInput('')}
                      className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md cursor-pointer"
                    >
                      清空
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 模式 3：对标竞争对手 */}
            {mode === 'COMPETITOR' && (
              <CompetitorAnalysisSection
                competitorInput={competitorInput}
                onCompetitorInputChange={setCompetitorInput}
              />
            )}
          </div>

          {/* 第三步：一键启动执行 */}
          <div className="space-y-2.5 pt-1">
            <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center text-xs sm:text-sm font-bold shadow-xs">3</span>
              <span>开始执行</span>
            </label>
            <button
              type="button"
              onClick={() => handleExecuteGenerateAndPublish()}
              disabled={executionActive || safeSites.length === 0 || activeSite?.connectorStatus !== 'CONNECTED'}
              className={`w-full py-3.5 sm:py-4 rounded-xl font-extrabold text-sm sm:text-base transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer min-h-[48px] sm:min-h-[52px] active:scale-[0.99] ${
                executionActive
                  ? 'bg-slate-800 text-slate-300 cursor-wait'
                  : 'bg-slate-950 hover:bg-slate-900 text-white'
              }`}
            >
              {executionActive ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  <span>正在生成并执行质量门禁，请稍候...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="truncate">
                    {activeSite?.connectorStatus !== 'CONNECTED' ? '请先授权连接 WordPress' : '组合全部增长线索并开始执行'}
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </>
              )}
            </button>
          </div>

        </div>

        {/* 流水线状态反馈 */}
        <div className="border-t border-slate-100 pt-5 space-y-4">
          {/* 物理大括号视觉组件 */}
          <div className="flex flex-col items-center justify-center text-center -space-y-1 py-1 select-none">
            <div className="w-full max-w-4xl px-4">
              <svg className="w-full h-8 text-slate-300" viewBox="0 0 1000 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M 12 24 C 12 14, 20 12, 100 12 L 470 12 C 490 12, 492 4, 500 0 L 500 0 C 508 4, 510 12, 530 12 L 900 12 C 980 12, 988 14, 988 24"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </div>
            <span className="text-xs font-bold text-slate-500 tracking-wider uppercase bg-white px-4 z-10 text-center">
              <span className="hidden sm:inline">5 阶段真实增长链路 · 发布完成即交付，效果观察独立继续</span>
              <span className="inline sm:hidden">5 阶段真实进度</span>
            </span>
          </div>

          <PipelineVisualizer
            activePipelineStep={activePipelineStep}
            stepStates={pipelineStepStates}
            executionLogs={executionLogs}
            stageDetails={persistedGrowthStatus?.stages}
          />
        </div>

      </div>

      {/* 最新生成结果直接呈现（直达结果） */}
      {latestPublishedDraft && (
        <div className="bg-emerald-50/70 border border-emerald-200/90 rounded-2xl p-4 sm:p-6 space-y-4 shadow-xs animate-in zoom-in-95 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-emerald-950 font-bold text-base">
              <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs shadow-2xs font-black shrink-0">
                ✓
              </span>
              <span>{actionLabel(persistedGrowthStatus?.action?.type)}已通过门禁并交付到您的网站</span>
            </div>

            <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-100/90 text-emerald-800 border border-emerald-300/80 self-start sm:self-auto">
              质量评分: {latestPublishedDraft.qualityGate?.overallScore ?? '未返回'}
            </span>
          </div>

          <div className="bg-white p-4 sm:p-5 rounded-xl border border-emerald-200/80 space-y-1.5 shadow-2xs">
            <h3 className="font-bold text-slate-900 text-base sm:text-lg tracking-tight">
              {latestPublishedDraft.title}
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed">
              {latestPublishedDraft.summary}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <div className="flex items-center gap-2">
              {latestPublishedDraft.publishedUrl && (
                <a
                  href={latestPublishedDraft.publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs min-h-[38px]"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>在官网查看结果</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => setPreviewDraft(latestPublishedDraft)}
                className="px-4 py-2 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200/90 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs min-h-[38px] cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-slate-500" />
                <span>预览正文</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setKeywordInput('');
                setLatestPublishedDraft(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-900 font-semibold underline underline-offset-2 transition-colors py-1 cursor-pointer"
            >
              继续执行下一次
            </button>
          </div>
        </div>
      )}

      {/* 底部：最近发布的文章列表 */}
      {recentArticles.length > 0 && (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>最近增长交付记录</span>
            </h3>
            <span className="text-xs font-medium text-slate-400">
              共 {safeDrafts.length} 项
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {recentArticles.map((draft) => {
              const draftSite = safeSites.find(s => s.id === draft.siteId);
              const isPub = draft.status === 'PUBLISHED';
              const growthAction = actionByDraftId.get(draft.id);

              return (
                <div key={draft.id} className="py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm hover:bg-slate-50/50 -mx-2 px-2 rounded-xl transition-colors">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-lg text-xs font-semibold border bg-slate-50 text-slate-700 border-slate-200/90">
                        {actionLabel(growthAction?.type)}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-lg text-xs font-semibold border ${draft.qualityGate ? 'bg-emerald-50 text-emerald-700 border-emerald-200/90' : 'bg-slate-100 text-slate-600 border-slate-200/90'}`}>
                        {draft.qualityGate ? `${draft.qualityGate.overallScore} 分` : '未质检'}
                      </span>
                      {draftSite && (
                        <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                          <Globe className="w-3 h-3 text-slate-400" />
                          {draftSite.domain}
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        {draft.publishedAt ? new Date(draft.publishedAt).toLocaleDateString() : '刚刚'}
                      </span>
                    </div>

                    <div
                      onClick={() => setPreviewDraft(draft)}
                      className="font-bold text-slate-900 truncate hover:text-emerald-700 cursor-pointer text-sm sm:text-base transition-colors"
                    >
                      {draft.title}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {isPub && draft.publishedUrl && (
                      <a
                        href={draft.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 min-h-[36px]"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                        <span>访问</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => setPreviewDraft(draft)}
                      className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 active:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs min-h-[36px] cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-300" />
                      <span>预览</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL: 文章详情预览 */}
      <DraftPreviewModal
        draft={previewDraft}
        onClose={() => setPreviewDraft(null)}
        onRollback={handleRollback}
      />

    </div>
  );
};
