import React, { useState, useMemo, useCallback } from 'react';
import {
  WordPressSite,
  ArticleDraft,
  AUTOMATION_PIPELINE_STAGES,
  PipelineStepStates,
  PipelineStepStatus
} from '../types/seo';
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
  onTriggerScan: (keyword?: string, siteId?: string) => Promise<any>;
  onRollback?: (draftId: string) => Promise<void>;
  onRunCruise?: (
    siteIds: string[],
    addLog: (msg: string) => void,
    setPipelineStep: (step: number, status: PipelineStepStatus) => void,
    keyword?: string
  ) => Promise<ArticleDraft | undefined>;
  onOpenOnboarding?: () => void;
}

const initialPipelineStepStates = (): PipelineStepStates => Object.fromEntries(
  AUTOMATION_PIPELINE_STAGES.map(({ number }) => [number, 'PENDING'])
) as PipelineStepStates;

export const MainDashboard: React.FC<MainDashboardProps> = ({
  sites = [],
  drafts = [],
  onTriggerScan,
  onRollback,
  onRunCruise,
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

  // 三种真实执行入口：自定义关键词、客户授权旧文更新、竞品差异化研究。
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

  const setPipelineStep = useCallback((step: number, status: PipelineStepStatus) => {
    setPipelineStepStates((previous) => ({ ...previous, [step]: status }));
    setActivePipelineStep((previous) => {
      if (status === 'RUNNING') return step;
      return previous === step ? null : previous;
    });
  }, []);

  // 最近生成的文章列表
  const recentArticles = useMemo(() => {
    return safeDrafts.slice(0, 5);
  }, [safeDrafts]);

  // 傻瓜式一键执行（无论是常规词还是竞品词）
  const handleExecuteGenerateAndPublish = async (overrideKeyword?: string) => {
    const targetSiteId = selectedSiteId || safeSites[0]?.id;
    if (!targetSiteId && safeSites.length === 0) {
      showToast('请先配置目标站点');
      return;
    }

    let keywordToUse = overrideKeyword;

    if (!keywordToUse) {
      if (mode === 'KEYWORD') {
        if (!keywordInput.trim()) {
          showToast('请输入一个核心关键词或主题');
          return;
        }
        keywordToUse = keywordInput.trim();
      } else if (mode === 'REWRITE') {
        if (!rewriteInput.trim()) {
          showToast('请输入您拥有使用授权的旧文章 URL 或素材');
          return;
        }
        keywordToUse = `[二次创作/改写] ${rewriteInput.trim()}`;
      } else if (mode === 'COMPETITOR') {
        if (!competitorInput.trim()) {
          showToast('请输入竞品网站 URL');
          return;
        }
        keywordToUse = `[竞品对标截流] ${competitorInput.trim()}`;
      }
    }
    const targetSiteIds = targetSiteId ? [targetSiteId] : safeSites.map(s => s.id);

    setIsRunning(true);
    setExecutionLogs([]);
    setPipelineStepStates(initialPipelineStepStates());
    setLatestPublishedDraft(null);

    const addLog = (msg: string) => {
      setExecutionLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    try {
      if (onRunCruise) {
        const publishedDraft = await onRunCruise(targetSiteIds, addLog, setPipelineStep, keywordToUse || undefined);
        if (publishedDraft?.status === 'PUBLISHED') {
          setLatestPublishedDraft(publishedDraft);
        }
        showToast(publishedDraft?.status === 'PUBLISHED'
          ? '文章已发布'
          : publishedDraft?.status === 'QUALITY_FAILED'
            ? '文章已生成，但未通过质量门禁'
            : publishedDraft
              ? '草稿已生成，请到“我的内容”审核发布'
              : '执行未返回草稿，请查看任务日志');
      } else {
        setPipelineStep(1, 'RUNNING');
        addLog(`[意图挖掘] 分析长尾关键词: ${keywordToUse || activeSite?.niche || '站点主题'}`);
        await onTriggerScan(keywordToUse || undefined, targetSiteId);

        addLog('[流程中止] 当前工作区未连接真实执行处理器，未生成、发布或推送任何内容。');
        setPipelineStep(1, 'FAILED');
        showToast('执行处理器未连接，未执行发布操作');
      }
    } catch (e: any) {
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
      setIsRunning(false);
      setActivePipelineStep(null);
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
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">



        {/* 步骤 1 & 2 & 3 表单 */}
        <div className="space-y-6">

          {/* 第一步：选择发布站点 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
                <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center text-xs sm:text-sm font-bold shadow-xs">1</span>
                <span>选择站点</span>
              </label>

              {safeSites.length > 0 && onOpenOnboarding && (
                <button
                  type="button"
                  onClick={onOpenOnboarding}
                  className="text-xs sm:text-[13px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>+ 添加站点</span>
                </button>
              )}
            </div>

            {safeSites.length === 0 ? (
              <div className="p-4 bg-amber-50/80 rounded-xl border border-amber-200 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>暂未绑定站点，请先接入目标 WordPress 网站。</span>
                </div>
                {onOpenOnboarding && (
                  <button
                    type="button"
                    onClick={onOpenOnboarding}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs transition shrink-0 cursor-pointer"
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
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50/80 hover:bg-slate-100/80 border border-slate-200/90 rounded-xl text-xs sm:text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 focus:bg-white transition cursor-pointer appearance-none shadow-2xs"
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
          </div>

          {/* 第二步：设定发文主题 */}
          <div className="space-y-3 pt-1">
            <label className="text-base sm:text-lg font-extrabold text-slate-950 flex items-center gap-2.5">
              <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center text-xs sm:text-sm font-bold shadow-xs">2</span>
              <span>选择主题</span>
            </label>

            {/* 3 种模式切换 Tab */}
            <div className="grid grid-cols-3 p-1 bg-slate-100 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setMode('KEYWORD')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer ${
                  mode === 'KEYWORD'
                    ? 'bg-slate-950 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">自定义关键词</span>
                <span className="inline sm:hidden">关键词</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('REWRITE')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer ${
                  mode === 'REWRITE'
                    ? 'bg-slate-950 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Repeat className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">二次创作</span>
                <span className="inline sm:hidden">二创</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('COMPETITOR')}
                className={`px-1.5 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer ${
                  mode === 'COMPETITOR'
                    ? 'bg-slate-950 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Swords className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="hidden sm:inline">对标竞品</span>
                <span className="inline sm:hidden">对标竞品</span>
              </button>
            </div>

            {/* 模式 1：自定义关键词 */}
            {mode === 'KEYWORD' && (
              <div className="space-y-2.5 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/60">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-slate-500" />
                    输入核心关键词或主题
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="例如：2026年企业级高可用架构实操指南..."
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs"
                  />
                  {keywordInput && (
                    <button
                      type="button"
                      onClick={() => setKeywordInput('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md"
                    >
                      清空
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 模式 2：客户授权旧文的差异化更新 */}
            {mode === 'REWRITE' && (
              <div className="space-y-2.5 animate-in fade-in duration-150 bg-slate-50/70 p-3.5 sm:p-4 rounded-xl border border-slate-200/60">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-slate-500" />
                    输入已授权的旧文章 URL 或素材
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="url"
                    value={rewriteInput}
                    onChange={(e) => setRewriteInput(e.target.value)}
                    placeholder="仅限您拥有使用授权的文章链接 (如 https://example.com/blog/...)"
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all duration-150 shadow-2xs"
                  />
                  {rewriteInput && (
                    <button
                      type="button"
                      onClick={() => setRewriteInput('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md"
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
              disabled={isRunning || safeSites.length === 0 || activeSite?.connectorStatus !== 'CONNECTED'}
              className={`w-full py-3.5 sm:py-4 rounded-xl font-extrabold text-sm sm:text-base transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer min-h-[48px] sm:min-h-[52px] active:scale-[0.99] ${
                isRunning
                  ? 'bg-slate-800 text-slate-300 cursor-wait'
                  : 'bg-slate-950 hover:bg-slate-900 text-white'
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  <span>正在生成并执行质量门禁，请稍候...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
                  <span className="truncate">
                    {activeSite?.connectorStatus !== 'CONNECTED' ? '请先完成 WordPress 真实连接测试' : mode === 'KEYWORD' ? (keywordInput ? `针对「${keywordInput.slice(0, 16)}${keywordInput.length > 16 ? '...' : ''}」开始执行` : '输入关键词后开始执行') : mode === 'REWRITE' ? '开始二创内容执行' : (competitorInput ? `针对竞品「${competitorInput.slice(0, 16)}」开始执行` : '输入竞品站点后开始执行')}
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
              <span className="hidden sm:inline">8 阶段生产链路 · 发布与收录在人工审核后继续</span>
              <span className="inline sm:hidden">8 阶段自动巡航</span>
            </span>
          </div>

          <PipelineVisualizer
            activePipelineStep={activePipelineStep}
            stepStates={pipelineStepStates}
            executionLogs={executionLogs}
          />
        </div>

      </div>

      {/* 最新生成结果直接呈现（直达结果） */}
      {latestPublishedDraft && (
        <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 sm:p-6 space-y-4 shadow-sm animate-in zoom-in-95 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
              <span className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs">
                ✓
              </span>
              <span>文章已通过质检并发布到您的网站</span>
            </div>

            <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 self-start sm:self-auto">
              质量评分: {latestPublishedDraft.qualityGate?.overallScore ?? '未返回'}
            </span>
          </div>

          <div className="bg-white p-4 rounded-md border border-emerald-200 space-y-1.5">
            <h3 className="font-bold text-slate-900 text-base">
              {latestPublishedDraft.title}
            </h3>
            <p className="text-xs text-slate-600 line-clamp-2">
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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>在官网查看文章</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => setPreviewDraft(latestPublishedDraft)}
                className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/80 rounded-md text-xs font-medium transition flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>预览正文</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setKeywordInput('');
                setLatestPublishedDraft(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium underline"
            >
              继续生成下一篇
            </button>
          </div>
        </div>
      )}

      {/* 底部：最近发布的文章列表 */}
      {recentArticles.length > 0 && (
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>最近生成的文章记录</span>
            </h3>
            <span className="text-xs text-slate-400">
              共 {safeDrafts.length} 篇
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {recentArticles.map((draft) => {
              const draftSite = safeSites.find(s => s.id === draft.siteId);
              const isPub = draft.status === 'PUBLISHED';

              return (
                <div key={draft.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${draft.qualityGate ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                        {draft.qualityGate ? `${draft.qualityGate.overallScore} 分` : '未质检'}
                      </span>
                      {draftSite && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
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
                      className="font-semibold text-slate-900 truncate hover:text-emerald-700 cursor-pointer text-sm sm:text-base"
                    >
                      {draft.title}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
                    {isPub && draft.publishedUrl && (
                      <a
                        href={draft.publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>访问</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => setPreviewDraft(draft)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-medium transition flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
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
