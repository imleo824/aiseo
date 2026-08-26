import React, { useState, useMemo } from 'react';
import { 
  WordPressSite, 
  KeywordOpportunityItem, 
  KeywordVulnerabilityType,
  ArticleDraft
} from '../types/seo';
import { createApiService } from '../services/api';
import { 
  Zap, 
  Search, 
  Check, 
  Copy, 
  ChevronDown,
  ChevronUp,
  HelpCircle,
  X,
  Info
} from 'lucide-react';

interface MetricHelpInfo {
  title: string;
  badge?: string;
  formula?: string;
  description: string;
  bestPractice: string;
}

const METRIC_HELP_MAP: Record<string, MetricHelpInfo> = {
  KGR: {
    title: 'KGR 黄金词 (Keyword Golden Ratio)',
    badge: 'KGR < 0.25',
    formula: 'KGR = Google 中 title 包含该词的网页总数 ÷ 月搜索量',
    description: 'KGR 以 allintitle 结果与可靠的月搜索量估算内容供给密度。它只能作为筛选信号，不代表排名承诺。',
    bestPractice: '仅在已接入搜索量数据且完成 SERP 人工核验后使用；还需结合站点权威度、内容质量与索引状况判断。'
  },
  SERP_VULNERABILITY: {
    title: 'SERP 漏洞词 (SERP Weakness)',
    badge: '弱点洞察',
    description: '指当前 Google / 百度搜索结果首页被论坛帖子（如 Reddit、Quora、知乎）、问答社区或 2 年以上未更新的老旧文章占领。',
    bestPractice: '应逐条核对结果页、意图与内容质量，再决定是否创建更完整的内容；不应将论坛结果本身视为排名保证。'
  },
  COMMERCIAL: {
    title: '商业高转化词 (Commercial Intent)',
    badge: '高转化率',
    description: '带有明确购买决策、选型调查或替代方案意图的关键词（如“Stripe 替代方案”、“最佳低成本 SaaS 计费平台”）。',
    bestPractice: '将其与真实转化、产品匹配度和落地页表现一起评估，不应仅凭词面判断收益。'
  },
  PAIN_POINT: {
    title: '痛点长尾词 (Pain-point Longtail)',
    badge: '精准避坑',
    description: '针对具体的业务报错、技术排坑或特定场景问题（如“如何解决扣款重试失败”）。',
    bestPractice: '将其与客户支持、站内搜索和转化数据交叉验证，再决定是否作为内容切入点。'
  },
  ROI_SCORE: {
    title: 'ROI 综合性价比得分',
    badge: '0 ~ 100 分',
    formula: 'ROI 得分 = 综合评估 (商业意图权重 + SERP 漏洞加成) ÷ 竞争难度 KD',
    description: 'ROI 必须基于可追溯的搜索量、难度、业务价值和实际成本计算。未接入数据源时不会显示该分数。',
    bestPractice: '只对有明确数据来源与计算版本的分数排序，并持续用实际流量和转化回测。'
  }
};

interface ProKeywordRadarTabProps {
  sites: WordPressSite[];
  onLaunchCruiseWithKeyword?: (keyword: string, siteId?: string) => Promise<ArticleDraft | undefined>;
  onAddAutopilotTask?: (taskData: any) => Promise<void>;
}

export const ProKeywordRadarTab: React.FC<ProKeywordRadarTabProps> = ({
  sites = [],
  onLaunchCruiseWithKeyword
}) => {
  const [seedKeyword, setSeedKeyword] = useState<string>('SaaS Billing');
  const [selectedSiteId, setSelectedSiteId] = useState<string>(() => sites[0]?.id || '');
  const [filterType, setFilterType] = useState<'ALL' | KeywordVulnerabilityType>('ALL');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // 指标说明 Modal 状态
  const [activeHelpKey, setActiveHelpKey] = useState<string | null>(null);

  const [opportunities, setOpportunities] = useState<KeywordOpportunityItem[]>([]);

  // 运行关键词雷达挖掘
  const handleRunRadarScan = async (queryToScan?: string) => {
    const query = (queryToScan || seedKeyword).trim();
    if (!query) return;

    setIsScanning(true);
    try {
      const api = createApiService();
      const data = await api.serpScan({ seedKeyword: query }).catch(() => null);

      if (!data || !Array.isArray(data.opportunities)) {
        throw new Error('关键词服务未返回可验证的数据，未生成任何机会词。');
      }
      setOpportunities(data.opportunities);
    } catch (error: any) {
      setOpportunities([]);
      window.alert(error?.message || '关键词扫描失败，未生成任何机会词。');
    } finally {
      setIsScanning(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const filteredOpps = useMemo(() => {
    if (filterType === 'ALL') return opportunities;
    return opportunities.filter(item => item.vulnerabilityType === filterType);
  }, [opportunities, filterType]);

  return (
    <div className="w-full space-y-6 sm:space-y-8 animate-in fade-in duration-200">
      
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">

        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-2.5 md:items-center">
            <div className="flex flex-row items-center gap-2 flex-1">
              {sites.length > 0 && (
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="px-3 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-bold text-slate-800 focus:outline-none cursor-pointer shrink-0 transition"
                >
                  {sites.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={seedKeyword}
                  onChange={(e) => setSeedKeyword(e.target.value)}
                  placeholder="输入核心种子词 (如 SaaS Billing / 外贸软件 / WordPress)..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition font-medium"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleRunRadarScan()}
              disabled={isScanning || !seedKeyword.trim()}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm shrink-0 disabled:opacity-50 cursor-pointer h-[38px]"
            >
              {isScanning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  <span>查询数据源...</span>
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5 text-slate-300" />
                  <span>查询真实关键词</span>
                </>
              )}
            </button>
          </div>


        </div>

      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
        
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { id: 'ALL', label: `全部 (${opportunities.length})`, helpKey: null },
              { id: 'KGR_GOLD', label: '黄金词 (KGR<0.25)', helpKey: 'KGR' },
              { id: 'SERP_FORUM_VULNERABILITY', label: 'SERP 漏洞词', helpKey: 'SERP_VULNERABILITY' },
              { id: 'COMMERCIAL_CONVERSION', label: '商业高转化', helpKey: 'COMMERCIAL' },
              { id: 'PAIN_POINT_LONGTAIL', label: '痛点长尾词', helpKey: 'PAIN_POINT' }
            ].map(tab => (
              <div key={tab.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setFilterType(tab.id as any)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
                    filterType === tab.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
                {tab.helpKey && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveHelpKey(tab.helpKey);
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                    title="点击查看此指标说明"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <span className="text-xs text-slate-400 font-medium">
            搜索结果: {filteredOpps.length} 个关键词
          </span>
        </div>

        <div className="space-y-3">
          {filteredOpps.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-500">
              尚无可验证的关键词数据。连接 DataForSEO 后可获得搜索量、难度与完整 SERP 数据。
            </div>
          )}
          {filteredOpps.map((item) => {
            const isExpanded = expandedId === item.id;
            const vulnerabilityHelpKey = item.vulnerabilityType === 'KGR_GOLD' 
              ? 'KGR' 
              : item.vulnerabilityType === 'SERP_FORUM_VULNERABILITY' 
              ? 'SERP_VULNERABILITY' 
              : item.vulnerabilityType === 'COMMERCIAL_CONVERSION' 
              ? 'COMMERCIAL' 
              : 'PAIN_POINT';

            return (
              <div 
                key={item.id}
                className="p-4 sm:p-5 rounded-xl border border-slate-200/80 bg-white shadow-xs space-y-3 transition"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700">
                        <span>{item.vulnerabilityLabel}</span>
                        <button
                          type="button"
                          onClick={() => setActiveHelpKey(vulnerabilityHelpKey)}
                          className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                          title="查看类型说明"
                        >
                          <HelpCircle className="w-3 h-3" />
                        </button>
                      </span>

                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg">
                        <span>ROI: {item.roiScore > 0 ? `${item.roiScore} 分` : '未接入'}</span>
                        <button
                          type="button"
                          onClick={() => setActiveHelpKey('ROI_SCORE')}
                          className="text-emerald-500 hover:text-emerald-800 transition cursor-pointer"
                          title="查看 ROI 得分计算标准"
                        >
                          <HelpCircle className="w-3 h-3" />
                        </button>
                      </span>

                      <span className="text-[11px] font-mono text-slate-500">
                        月搜: {item.searchVolume > 0 ? `${item.searchVolume.toLocaleString()} 次` : '未接入'}
                      </span>

                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                        <span>KGR: {item.kgrIndex > 0 ? item.kgrIndex : '未接入'}</span>
                        <button
                          type="button"
                          onClick={() => setActiveHelpKey('KGR')}
                          className="text-slate-400 hover:text-rose-600 transition cursor-pointer"
                          title="查看 KGR 黄金比例公式"
                        >
                          <HelpCircle className="w-3 h-3" />
                        </button>
                      </span>
                    </div>

                    <h3 className="text-sm sm:text-base font-bold text-slate-900">
                      {item.keyword}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end sm:justify-start flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleCopyText(item.keyword, item.id)}
                      className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg transition"
                      title="复制关键词"
                    >
                      {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1"
                    >
                      <span>{isExpanded ? '收起大纲' : '查看建议'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (onLaunchCruiseWithKeyword) {
                          onLaunchCruiseWithKeyword(item.keyword, selectedSiteId);
                        }
                      }}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Zap className="w-3.5 h-3.5 fill-white text-white" />
                      <span>一键巡航发文</span>
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-500 line-clamp-1 border-t border-slate-100 pt-2.5">
                  <strong className="text-slate-700 font-semibold">漏洞盲区：</strong>
                  {item.serpWeaknesses.join('；')}
                </p>

                {isExpanded && (
                  <div className="p-3 bg-slate-50/80 rounded-xl space-y-2 text-xs text-slate-700 animate-in fade-in duration-150">
                    <div>
                      <span className="font-bold text-slate-900">推荐拟定标题：</span>
                      <span className="text-slate-800 font-medium">{item.recommendedTitle}</span>
                    </div>
                    <div>
                      <span className="font-bold text-slate-900">战术攻防切入：</span>
                      <span className="text-slate-600">{item.recommendedAngle}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="font-bold text-slate-900">建议 H2 提纲：</span>
                      {item.recommendedH2s.map((h2, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-white shadow-xs text-slate-600 text-[11px]">
                          H2: {h2}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            );
          })}
        </div>

      </div>

      {activeHelpKey && METRIC_HELP_MAP[activeHelpKey] && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div 
            className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-6 max-w-md w-full shadow-xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-800">
                  <Info className="w-4 h-4 text-rose-500" />
                </span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {METRIC_HELP_MAP[activeHelpKey].title}
                  </h3>
                  {METRIC_HELP_MAP[activeHelpKey].badge && (
                    <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">
                      {METRIC_HELP_MAP[activeHelpKey].badge}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setActiveHelpKey(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {METRIC_HELP_MAP[activeHelpKey].formula && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80/80 font-mono text-xs text-slate-700">
                <span className="text-slate-400 block text-[10px] uppercase font-semibold mb-0.5">计算公式</span>
                {METRIC_HELP_MAP[activeHelpKey].formula}
              </div>
            )}

            <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <p>{METRIC_HELP_MAP[activeHelpKey].description}</p>
            </div>

            <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100 text-xs text-rose-900 space-y-1">
              <strong className="font-bold flex items-center gap-1 text-rose-950">
                <span>💡 最佳部署实践：</span>
              </strong>
              <p className="text-rose-800/90 leading-relaxed">
                {METRIC_HELP_MAP[activeHelpKey].bestPractice}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setActiveHelpKey(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
            >
              我知道了
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
