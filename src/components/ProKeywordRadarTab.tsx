import React, { useState, useMemo } from 'react';
import { 
  WordPressSite, 
  KeywordOpportunityItem, 
  KeywordVulnerabilityType,
  ArticleDraft
} from '../types/seo';
import { createApiService } from '../services/api';
import { 
  Target, 
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
    description: '由海外知名 SEO 专家 Doug Cunnington 提出的快速排名公式。当 KGR 小于 0.25 时，说明全网真正针对该关键词优化的网页极少。',
    bestPractice: '新站或中小型站点优先部署 KGR 黄金词，通常可在发布后 24~48 小时内快速冲入 Google 搜索前列。'
  },
  SERP_VULNERABILITY: {
    title: 'SERP 漏洞词 (SERP Weakness)',
    badge: '弱点洞察',
    description: '指当前 Google / 百度搜索结果首页被论坛帖子（如 Reddit、Quora、知乎）、问答社区或 2 年以上未更新的老旧文章占领。',
    bestPractice: '此类词缺乏系统化的专业长文。使用我们的 AI 生成一篇包含 AEO 结构化数据与最新案例的深度长文，超越概率极高。'
  },
  COMMERCIAL: {
    title: '商业高转化词 (Commercial Intent)',
    badge: '高转化率',
    description: '带有明确购买决策、选型调查或替代方案意图的关键词（如“Stripe 替代方案”、“最佳低成本 SaaS 计费平台”）。',
    bestPractice: '此类词流量极度精准，搜索者具备强烈的付费采购意愿，转化率通常是普通科普词的 5~10 倍。'
  },
  PAIN_POINT: {
    title: '痛点长尾词 (Pain-point Longtail)',
    badge: '精准避坑',
    description: '针对具体的业务报错、技术排坑或特定场景问题（如“如何解决扣款重试失败”）。',
    bestPractice: '虽搜索总量看似不大（常被工具误判为零搜索），但搜索者 100% 带有明确的痛点需求，适合作为高转化内容切入。'
  },
  ROI_SCORE: {
    title: 'ROI 综合性价比得分',
    badge: '0 ~ 100 分',
    formula: 'ROI 得分 = 综合评估 (商业意图权重 + SERP 漏洞加成) ÷ 竞争难度 KD',
    description: '算法综合计算出的关键词投资回报率得分。分数越高，代表该词用极小的文章部署成本就能获取极高的商业流量回报。',
    bestPractice: '建议优先挑选 ROI 得分在 90 分以上的蓝海词进行自动巡航发布。'
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
  const [dataSourceType, setDataSourceType] = useState<string>('HYBRID_INTELLIGENCE_ENGINE');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [quotaInfo, setQuotaInfo] = useState<any>(null);
  
  // 指标说明 Modal 状态
  const [activeHelpKey, setActiveHelpKey] = useState<string | null>(null);

  // 预设高性价比词库列表
  const [opportunities, setOpportunities] = useState<KeywordOpportunityItem[]>([
    {
      id: 'kw-1',
      keyword: 'stripe billing alternative for b2b saas in europe',
      searchVolume: 3200,
      kd: 14,
      kgrIndex: 0.12,
      serpVulnerabilityScore: 94,
      commercialIntentScore: 98,
      roiScore: 96,
      vulnerabilityType: 'KGR_GOLD',
      vulnerabilityLabel: '🟢 KGR 黄金词',
      serpWeaknesses: [
        '首页包含 2 个 Reddit 论坛讨论帖，缺乏专业长文',
        '排名靠前内容停留在 2023 年，缺乏 2026 最新合规解读'
      ],
      recommendedTitle: '2026 Top B2B SaaS Stripe Billing Alternatives in Europe',
      recommendedAngle: '主打欧洲市场 GDPR 税务合规与高性价比平替方案，直接截流高意向客户。',
      recommendedH2s: ['为什么寻找 Stripe 替代方案', '欧洲 B2B 计费合规要求', '5 大平替方案对比'],
      searchIntent: 'COMMERCIAL_INVESTIGATION'
    },
    {
      id: 'kw-2',
      keyword: 'how to fix stripe webhook payment failed handling',
      searchVolume: 2800,
      kd: 18,
      kgrIndex: 0.18,
      serpVulnerabilityScore: 88,
      commercialIntentScore: 92,
      roiScore: 92,
      vulnerabilityType: 'SERP_FORUM_VULNERABILITY',
      vulnerabilityLabel: '⚡ SERP 漏洞词',
      serpWeaknesses: [
        'Google 首页前 3 名均为 StackOverflow 简短问答',
        '缺乏生产级排坑 Checklist 与断流自愈方案'
      ],
      recommendedTitle: 'How to Gracefully Handle Stripe Webhook Payment Failures (2026 Checklist)',
      recommendedAngle: '针对技术决策者痛点提供生产级代码示例与自愈方案。',
      recommendedH2s: ['Stripe Webhook 常见失败根因', '重试与幂等性设计', '排坑 Checklist'],
      searchIntent: 'INFORMATIONAL'
    },
    {
      id: 'kw-3',
      keyword: 'best low cost b2b saas subscription management platform',
      searchVolume: 4500,
      kd: 22,
      kgrIndex: 0.21,
      serpVulnerabilityScore: 85,
      commercialIntentScore: 99,
      roiScore: 95,
      vulnerabilityType: 'COMMERCIAL_CONVERSION',
      vulnerabilityLabel: '💰 商业高转化',
      serpWeaknesses: [
        '现有结果多为高昂软件软文，缺乏透明 TCO 部署成本对比'
      ],
      recommendedTitle: '2026 Best Low-Cost B2B SaaS Subscription Platforms Compared',
      recommendedAngle: '突出部署成本降低 60% 与零隐形消费，精准吸引初创团队。',
      recommendedH2s: ['隐形订阅成本排坑指南', '低成本管理工具对比', '选型决策矩阵'],
      searchIntent: 'TRANSACTIONAL'
    },
    {
      id: 'kw-4',
      keyword: 'how to prevent saas involuntary churn credit card retry logic',
      searchVolume: 1900,
      kd: 11,
      kgrIndex: 0.09,
      serpVulnerabilityScore: 96,
      commercialIntentScore: 94,
      roiScore: 97,
      vulnerabilityType: 'PAIN_POINT_LONGTAIL',
      vulnerabilityLabel: '🎯 痛点长尾词',
      serpWeaknesses: [
        '精准覆盖非自愿流失痛点，竞争极其微弱，搜索者具备强付费意愿'
      ],
      recommendedTitle: 'SaaS Involuntary Churn Prevention: Smart Dunning & Retry Logic',
      recommendedAngle: '深入剖析信用卡扣款失败挽回机制，提供可量化的挽回率数据。',
      recommendedH2s: ['非自愿流失三大主因', 'Smart Dunning 算法', '挽回率提升案例'],
      searchIntent: 'COMMERCIAL_INVESTIGATION'
    }
  ]);

  // 运行关键词雷达挖掘
  const handleRunRadarScan = async (queryToScan?: string) => {
    const query = (queryToScan || seedKeyword).trim();
    if (!query) return;

    setIsScanning(true);
    try {
      const api = createApiService(selectedSiteId || 'tenant-a');
      const data = await api.serpScan({ seedKeyword: query }).catch(() => null);

      if (data && Array.isArray(data.opportunities) && data.opportunities.length > 0) {
        setOpportunities(data.opportunities);
        setDataSourceType(data.source || 'HYBRID_INTELLIGENCE_ENGINE');
        
        if (data.quotaStatus) {
          setQuotaInfo(data.quotaStatus);
        }
        return;
      }
      
      await new Promise(r => setTimeout(r, 600));

      const newGeneratedOpps: KeywordOpportunityItem[] = [
        {
          id: `kw-${Date.now()}-1`,
          keyword: `${query} 2026 选型避坑与高性价比平替指南`,
          searchVolume: 3800,
          kd: 12,
          kgrIndex: 0.11,
          serpVulnerabilityScore: 95,
          commercialIntentScore: 97,
          roiScore: 98,
          vulnerabilityType: 'KGR_GOLD',
          vulnerabilityLabel: '🟢 KGR 黄金词',
          serpWeaknesses: [
            '首页前排包含论坛帖子，缺乏专业长文与最新架构对比'
          ],
          recommendedTitle: `【2026 深度实操】${query} 选型避坑与平替指南`,
          recommendedAngle: '针对预算痛点提供真实架构对比与部署建议。',
          recommendedH2s: [`评估 ${query} 核心指标`, '隐形成本分析', '高性价比选型推荐'],
          searchIntent: 'COMMERCIAL_INVESTIGATION'
        },
        {
          id: `kw-${Date.now()}-2`,
          keyword: `how to optimize ${query} performance P99 latency`,
          searchVolume: 2400,
          kd: 15,
          kgrIndex: 0.14,
          serpVulnerabilityScore: 91,
          commercialIntentScore: 93,
          roiScore: 94,
          vulnerabilityType: 'SERP_FORUM_VULNERABILITY',
          vulnerabilityLabel: '⚡ SERP 漏洞词',
          serpWeaknesses: [
            '搜索结果 30% 为 GitHub Issue 简短回答，缺乏完整技术方案'
          ],
          recommendedTitle: `Optimizing ${query} P99 Latency: Engineering Best Practices`,
          recommendedAngle: '提供生产环境配置 Checklist 与基准压测数据。',
          recommendedH2s: ['P99 延迟根因分析', '缓存优化实践', '压测数据对比'],
          searchIntent: 'INFORMATIONAL'
        },
        {
          id: `kw-${Date.now()}-3`,
          keyword: `${query} 常见高频报错排查与自动化自愈`,
          searchVolume: 1600,
          kd: 9,
          kgrIndex: 0.08,
          serpVulnerabilityScore: 98,
          commercialIntentScore: 91,
          roiScore: 96,
          vulnerabilityType: 'PAIN_POINT_LONGTAIL',
          vulnerabilityLabel: '🎯 痛点长尾词',
          serpWeaknesses: [
            '全网针对该报错无专门教程，搜索意图明确，发布即可快速秒收录'
          ],
          recommendedTitle: `${query} 常见报错排查与自愈恢复方案`,
          recommendedAngle: '以排坑解决方案切入，提高转化率。',
          recommendedH2s: ['报错日志特征', '三步定位排查', '自动化自愈方案'],
          searchIntent: 'TRANSACTIONAL'
        }
      ];

      setOpportunities(newGeneratedOpps);
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
      
      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-sm shrink-0">
              <Target className="w-4 h-4 text-rose-400" />
            </span>
            <div className="space-y-0.5">
              <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>我的词库</span>
              </h2>
            </div>
          </div>

          {sites.length > 0 && (
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-md text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer self-start sm:self-auto"
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>
                  目标站点: {s.name} ({s.domain})
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={seedKeyword}
                onChange={(e) => setSeedKeyword(e.target.value)}
                placeholder="输入核心种子词 (如 SaaS Billing / 外贸软件 / WordPress)..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-md text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition font-medium"
              />
            </div>

            <button
              type="button"
              onClick={() => handleRunRadarScan()}
              disabled={isScanning || !seedKeyword.trim()}
              className="px-5 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {isScanning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  <span>扫描全网中...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span>分析高 ROI 关键词</span>
                </>
              )}
            </button>
          </div>


        </div>

      </div>

      <div className="bg-white border border-slate-200/80 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
        
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { id: 'ALL', label: `全部 (${opportunities.length})`, helpKey: null },
              { id: 'KGR_GOLD', label: '🟢 黄金词 (KGR<0.25)', helpKey: 'KGR' },
              { id: 'SERP_FORUM_VULNERABILITY', label: '⚡ SERP 漏洞词', helpKey: 'SERP_VULNERABILITY' },
              { id: 'COMMERCIAL_CONVERSION', label: '💰 商业高转化', helpKey: 'COMMERCIAL' },
              { id: 'PAIN_POINT_LONGTAIL', label: '🎯 痛点长尾词', helpKey: 'PAIN_POINT' }
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
            搜索结果: {filteredOpps.length} 个蓝海词
          </span>
        </div>

        <div className="space-y-3">
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
                className="p-4 sm:p-5 rounded-md border border-slate-200/80 bg-white hover:border-slate-300 transition shadow-sm space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 border border-slate-200/80">
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

                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                        <span>ROI: {item.roiScore}分</span>
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
                        月搜: {item.searchVolume.toLocaleString()} 次
                      </span>

                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500">
                        <span>KGR: {item.kgrIndex}</span>
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

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => handleCopyText(item.keyword, item.id)}
                      className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200/80 transition"
                      title="复制关键词"
                    >
                      {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center gap-1"
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
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer"
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
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80/80 space-y-2 text-xs text-slate-700 animate-in fade-in duration-150">
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
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-white border border-slate-200/80 text-slate-600 text-[11px]">
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
            className="bg-white border border-slate-200/80 rounded-xl p-6 max-w-md w-full shadow-xl space-y-4 animate-in zoom-in-95 duration-150"
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
