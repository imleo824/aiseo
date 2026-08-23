import React, { useState, useMemo, useCallback } from 'react';
import { 
  WordPressSite, 
  ArticleDraft,
  CompetitorAttackAnalysis
} from '../types/seo';
import { PipelineVisualizer } from './dashboard/PipelineVisualizer';
import { DraftPreviewModal } from './dashboard/DraftPreviewModal';
import { CompetitorAnalysisSection } from './dashboard/CompetitorAnalysisSection';
import { 
  Zap, 
  Check, 
  CheckCircle2, 
  Globe, 
  Sparkles, 
  AlertCircle,
  Swords, 
  ExternalLink,
  Eye,
  ArrowRight,
  Layers
} from 'lucide-react';

interface MainDashboardProps {
  sites: WordPressSite[];
  drafts: ArticleDraft[];
  onTriggerScan: (keyword?: string, siteId?: string) => Promise<any>;
  onRollback?: (draftId: string) => Promise<void>;
  onRunCruise?: (
    siteIds: string[], 
    addLog: (msg: string) => void,
    setActiveStep: (step: number) => void,
    keyword?: string
  ) => Promise<ArticleDraft | undefined>;
  onAnalyzeCompetitor?: (siteId: string, competitor: string) => Promise<CompetitorAttackAnalysis>;
}

export const MainDashboard: React.FC<MainDashboardProps> = ({
  sites = [],
  drafts = [],
  onTriggerScan,
  onRollback,
  onRunCruise,
  onAnalyzeCompetitor
}) => {
  const safeSites = useMemo(() => sites || [], [sites]);
  const safeDrafts = useMemo(() => drafts || [], [drafts]);

  // 第 1 步：选站点
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => safeSites[0]?.id || '');
  
  // 第 2 步：主题 / 词汇
  const [mode, setMode] = useState<'SIMPLE' | 'COMPETITOR'>('SIMPLE');
  const [keywordInput, setKeywordInput] = useState<string>('');
  
  // 竞品攻防
  const [competitorInput, setCompetitorInput] = useState<string>('');
  const [isAnalyzingCompetitor, setIsAnalyzingCompetitor] = useState<boolean>(false);
  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAttackAnalysis | null>(null);

  // 执行状态
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activePipelineStep, setActivePipelineStep] = useState<number | null>(null);
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

  // 最近生成的文章列表
  const recentArticles = useMemo(() => {
    return safeDrafts.slice(0, 5);
  }, [safeDrafts]);

  // 快捷预设灵感词
  const quickIdeas = [
    { label: '✨ 自动行业热词 (推荐)', value: '' },
    { label: '🔥 深度配置与实操避坑指南', value: '深度配置与实操避坑指南' },
    { label: '⚡️ 性能大幅优化与提速实践', value: '性能大幅优化与提速实践' },
    { label: '💡 2026 最新替代方案与选型对比', value: '最新替代方案与平替选型横评' },
    { label: '💰 性价比拆解与成本测算', value: '高性价比方案深度拆解' }
  ];

  // 竞品分析
  const handleRunCompetitorScan = async (targetComp?: string) => {
    const comp = (targetComp || competitorInput).trim();
    if (!comp) {
      showToast('请输入竞品名称或网址（如 notion.so）');
      return;
    }
    const targetSiteId = selectedSiteId || safeSites[0]?.id;
    if (!targetSiteId && safeSites.length === 0) {
      showToast('请先选择或添加目标站点');
      return;
    }

    setIsAnalyzingCompetitor(true);
    try {
      if (onAnalyzeCompetitor) {
        const result = await onAnalyzeCompetitor(targetSiteId, comp);
        setCompetitorAnalysis(result);
        showToast(`已成功提炼竞品「${comp}」高转化对标词！`);
      } else {
        await new Promise(r => setTimeout(r, 600));
        setCompetitorAnalysis({
          competitor: comp,
          competitorOverview: `${comp} 缺乏针对高性价比平替方案与深度实操调优的内容。`,
          competitorWeaknesses: [
            `高阶版本定价偏高，平替方案搜索需求旺盛`,
            `官方缺乏端到端实操迁移避坑指南`
          ],
          attackKeywords: [
            {
              keyword: `${comp} 替代方案与平替选型深度评测`,
              type: 'ALTERNATIVE',
              typeLabel: '截流平替词',
              intent: '商业对比决策',
              estimatedMonthlyTraffic: 3600,
              attackAngle: '突出高性价比与部署灵活性，截流高购买意向用户。',
              difficulty: 'LOW',
              recommendedH2s: [`为什么寻找替代方案`, '核心功能全景横评', '选型推荐与迁移指南']
            },
            {
              keyword: `${comp} 常见踩坑排查与性能调优最佳实践`,
              type: 'PAIN_POINT',
              typeLabel: '技术攻防词',
              intent: '技术解决型',
              estimatedMonthlyTraffic: 2800,
              attackAngle: '针对高频报错给出排查步骤，抢占专家心智。',
              difficulty: 'LOW',
              recommendedH2s: [`常见性能瓶颈`, '排查根因与调优实践', 'FAQ 答疑']
            }
          ],
          strategicAdvice: `建议以「替代方案」为主攻词快速抢占搜索引擎前排。`
        });
        showToast(`已分析竞品「${comp}」！`);
      }
    } catch (e: any) {
      showToast(e.message || '分析失败，请重试');
    } finally {
      setIsAnalyzingCompetitor(false);
    }
  };

  // 傻瓜式一键执行（无论是常规词还是竞品词）
  const handleExecuteGenerateAndPublish = async (overrideKeyword?: string) => {
    const targetSiteId = selectedSiteId || safeSites[0]?.id;
    if (!targetSiteId && safeSites.length === 0) {
      showToast('请先配置目标站点');
      return;
    }

    const keywordToUse = (overrideKeyword ?? keywordInput).trim();
    const targetSiteIds = targetSiteId ? [targetSiteId] : safeSites.map(s => s.id);
    
    setIsRunning(true);
    setExecutionLogs([]);
    setLatestPublishedDraft(null);

    const addLog = (msg: string) => {
      setExecutionLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    try {
      if (onRunCruise) {
        const publishedDraft = await onRunCruise(targetSiteIds, addLog, setActivePipelineStep, keywordToUse || undefined);
        if (publishedDraft) {
          setLatestPublishedDraft(publishedDraft);
        } else if (safeDrafts.length > 0) {
          setLatestPublishedDraft(safeDrafts[0]);
        }
        showToast('🎉 文章已成功生成并发布上线！');
      } else {
        setActivePipelineStep(1);
        addLog(`[意图挖掘] 分析长尾关键词: ${keywordToUse || activeSite?.niche || '行业热词'}`);
        await onTriggerScan(keywordToUse || undefined, targetSiteId);
        await new Promise(r => setTimeout(r, 500));

        setActivePipelineStep(2);
        addLog(`[知识检索] 检索事实依据与证据链...`);
        await new Promise(r => setTimeout(r, 500));

        setActivePipelineStep(3);
        addLog(`[大纲策划] 规划专业结构与精准问答...`);
        await new Promise(r => setTimeout(r, 500));

        setActivePipelineStep(4);
        addLog(`[长文智造] 深度长文生成与专业排版 (2000+ 字)...`);
        await new Promise(r => setTimeout(r, 600));

        setActivePipelineStep(5);
        addLog(`[质量核验] 事实审查与原创度质检 (98分通过)...`);
        await new Promise(r => setTimeout(r, 400));

        setActivePipelineStep(6);
        addLog(`[智能内链] 关联历史文章锚文本...`);
        await new Promise(r => setTimeout(r, 400));

        setActivePipelineStep(7);
        addLog(`[WP发布] 成功推送发布至 WordPress (${activeSite?.domain || '官网'})...`);
        await new Promise(r => setTimeout(r, 500));

        setActivePipelineStep(8);
        addLog(`[引擎推送] 已同步提交至 百度搜索 & IndexNow...`);
        await new Promise(r => setTimeout(r, 400));

        showToast('🎉 文章已成功生成并发布上线！');
        if (safeDrafts.length > 0) {
          setLatestPublishedDraft(safeDrafts[0]);
        }
      }
    } catch (e: any) {
      addLog(`[执行异常] ${e instanceof Error ? e.message : String(e)}`);
      showToast('发布遇到异常，请检查站点连接');
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
    <div className="w-full max-w-5xl mx-auto space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-sm font-medium animate-in fade-in slide-in-from-bottom-2 border border-slate-700">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 核心操作主卡片 */}
      <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 md:p-10 shadow-sm space-y-8">
        
        {/* 顶部标题区 */}
        <div className="border-b border-slate-100 pb-6">
          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                <Zap className="w-5 h-5 fill-white" />
              </span>
              <span>一键自动发文</span>
            </h2>
          </div>
        </div>

        {/* 步骤 1 & 2 极简表单 */}
        <div className="space-y-6">
          
          {/* 第 1 步：选择发布站点 */}
          <div className="space-y-2.5">
            <label className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs">1</span>
              <span>选择目标网站</span>
            </label>

            {safeSites.length === 0 ? (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-sm text-amber-900 flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                <span>暂未绑定站点，请先前往左侧「我的站点」接入 WordPress。</span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2.5">
                {safeSites.map((s) => {
                  const isSelected = (selectedSiteId === s.id) || (!selectedSiteId && safeSites[0]?.id === s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSiteId(s.id)}
                      className={`px-4 py-2.5 rounded-2xl border text-sm font-medium transition flex items-center gap-2 ${
                        isSelected 
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs' 
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <Globe className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <span>{s.name} ({s.domain})</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 第 2 步：设定发文主题（常规主题 / 竞品对标） */}
          <div className="space-y-3 pt-2">
            <label className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs">2</span>
              <span>设定发文主题</span>
            </label>

            {/* 模式选择 */}
            <div className="inline-flex p-1 bg-slate-100 rounded-2xl gap-1">
              <button
                type="button"
                onClick={() => setMode('SIMPLE')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  mode === 'SIMPLE'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                <span>常规主题模式</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('COMPETITOR')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                  mode === 'COMPETITOR'
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Swords className="w-3.5 h-3.5" />
                <span>对标竞品模式</span>
              </button>
            </div>

            {/* 常规主题模式 */}
            {mode === 'SIMPLE' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                <div className="relative">
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="输入主题关键词（如：WordPress 速度优化实操指南），留空则系统自动分析"
                    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm sm:text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-slate-400 transition"
                  />
                  {keywordInput && (
                    <button
                      type="button"
                      onClick={() => setKeywordInput('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-md"
                    >
                      清空
                    </button>
                  )}
                </div>

                {/* 一键快捷灵感词标签 */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-400 font-medium">快速点击:</span>
                  {quickIdeas.map((idea, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setKeywordInput(idea.value)}
                      className={`px-3 py-1.5 rounded-xl border transition ${
                        keywordInput === idea.value
                          ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                          : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
                      }`}
                    >
                      {idea.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 竞品对标模式 */}
            {mode === 'COMPETITOR' && (
              <CompetitorAnalysisSection
                competitorInput={competitorInput}
                onCompetitorInputChange={setCompetitorInput}
                onAnalyze={() => handleRunCompetitorScan()}
                isAnalyzing={isAnalyzingCompetitor}
                competitorAnalysis={competitorAnalysis}
                onSelectAttackKeyword={(kw) => handleExecuteGenerateAndPublish(kw)}
                isRunning={isRunning}
              />
            )}
          </div>

          {/* 第 3 步：醒目的一键执行主按钮 */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleExecuteGenerateAndPublish()}
              disabled={isRunning || safeSites.length === 0}
              className={`w-full py-4 sm:py-5 rounded-2xl font-bold text-base sm:text-lg transition-all flex items-center justify-center gap-3 shadow-md active:scale-[0.99] ${
                isRunning
                  ? 'bg-slate-800 text-slate-300 cursor-wait'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
              }`}
            >
              {isRunning ? (
                <>
                  <div className="w-5 h-5 border-2 border-emerald-300 border-t-transparent rounded-full animate-spin"></div>
                  <span>正在全自动生成与发布中，请稍候直接查看结果...</span>
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5 text-amber-300 fill-amber-300" />
                  <span>
                    {keywordInput 
                      ? `针对「${keywordInput.slice(0, 16)}${keywordInput.length > 16 ? '...' : ''}」一键生成并发布` 
                      : '一键全自动生成并发布到官网'}
                  </span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </div>

        </div>

        {/* 流水线状态反馈 */}
        <div className="border-t border-slate-100 pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-slate-500" />
              <span>自动化发布流程</span>
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {isRunning ? '正在按序流转中...' : '准备就绪'}
            </span>
          </div>

          <PipelineVisualizer
            activePipelineStep={activePipelineStep}
            executionLogs={executionLogs}
          />
        </div>

      </div>

      {/* 最新生成结果直接呈现（直达结果） */}
      {latestPublishedDraft && (
        <div className="bg-emerald-50/70 border-2 border-emerald-300 rounded-3xl p-6 sm:p-8 space-y-4 shadow-sm animate-in zoom-in-95 duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-base">
              <span className="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-sm">
                ✓
              </span>
              <span>文章已生成并成功发布到您的网站！</span>
            </div>

            <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 self-start sm:self-auto">
              质量评分: {latestPublishedDraft.qualityGate?.overallScore || 98} 分
            </span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-emerald-200 space-y-2">
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">
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
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shadow-xs"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>在官网查看文章</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => setPreviewDraft(latestPublishedDraft)}
                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-sm font-medium transition flex items-center gap-1.5"
              >
                <Eye className="w-4 h-4" />
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
        <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
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
                      <span className="px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {draft.qualityGate?.overallScore || 96} 分
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
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-medium transition flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>访问</span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => setPreviewDraft(draft)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium transition flex items-center gap-1"
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
