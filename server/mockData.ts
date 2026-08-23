import { WordPressSite, Opportunity, KnowledgeSource, AuditLogItem, UsageLedgerItem, ArticleDraft, BaiduSubmissionLog } from '../src/types/seo';

export const initialSites: WordPressSite[] = [
  {
    id: 'site-1',
    name: 'TechPulse Media (科技脉搏)',
    domain: 'techpulse.media',
    niche: '人工智能与企业SaaS架构',
    siteType: 'WORDPRESS',
    siteLanguage: 'zh-CN',
    pagesCount: 1420,
    connectorStatus: 'CONNECTED',
    wpVersion: '6.7.1',
    pluginInstalled: true,
    whitelistedCategories: ['AI实践案例', '企业架构指南', '开源工具测评'],
    leadCaptureCta: {
      enabled: true,
      title: '预约企业级 AI 架构私有化部署与性能咨询',
      buttonText: '一键免费预约架构师',
      targetUrl: 'https://techpulse.media/book-demo?utm_source=autoseo&utm_medium=organic_cta',
      calloutNote: '免费获取《2026 算力成本测算模型》与 1v1 方案定制'
    },
    healthDiagnostics: {
      restApiStatus: true,
      authStatus: true,
      sitemapStatus: true,
      permalinkStatus: true,
      indexNowStatus: true,
      lastCheckedAt: '2026-08-20T10:00:00Z'
    },
    gscConnected: true,
    ga4Connected: true,
    baiduConnected: true,
    autopilotEnabled: true,
    weeklyPublishCap: 3,
    currentWeeklyPublished: 1,
    calibration: {
      isCalibrating: false,
      daysRemaining: 0,
      totalApprovedRequired: 10,
      approvedCount: 12,
      rejectedCount: 1,
      zeroFactErrorStreak: 12,
      autoPublishUnlocked: true
    },
    monthlyBudgetLimit: 150,
    monthlyBudgetUsed: 38.5,
    createdAt: '2026-01-15T08:00:00Z'
  },
  {
    id: 'site-2',
    name: 'Global Cloud Architecture (英文站)',
    domain: 'globalcloudarch.io',
    niche: 'Cloud Native & DevOps Engineering',
    siteType: 'WORDPRESS',
    siteLanguage: 'en',
    pagesCount: 880,
    connectorStatus: 'CONNECTED',
    wpVersion: '6.6.2',
    pluginInstalled: true,
    whitelistedCategories: ['Kubernetes Tutorials', 'DevOps Insights', 'Cloud Security'],
    leadCaptureCta: {
      enabled: true,
      title: 'Get Free Kubernetes Multi-Cluster Assessment',
      buttonText: 'Schedule Engineering Review',
      targetUrl: 'https://globalcloudarch.io/consult?utm_source=autoseo&utm_medium=cta',
      calloutNote: 'Includes instant cloud cost audit & security scorecard'
    },
    healthDiagnostics: {
      restApiStatus: true,
      authStatus: true,
      sitemapStatus: true,
      permalinkStatus: true,
      indexNowStatus: true,
      lastCheckedAt: '2026-08-20T09:30:00Z'
    },
    gscConnected: true,
    ga4Connected: true,
    baiduConnected: false,
    autopilotEnabled: true,
    weeklyPublishCap: 2,
    currentWeeklyPublished: 0,
    calibration: {
      isCalibrating: true,
      daysRemaining: 4,
      totalApprovedRequired: 10,
      approvedCount: 6,
      rejectedCount: 0,
      zeroFactErrorStreak: 6,
      autoPublishUnlocked: false
    },
    monthlyBudgetLimit: 100,
    monthlyBudgetUsed: 22.1,
    createdAt: '2026-03-01T10:00:00Z'
  }
];

export const initialOpportunities: Opportunity[] = [
  {
    id: 'opp-101',
    siteId: 'site-1',
    title: '针对关键词“企业级 DeepSeek 私有化部署性能调优”的新文章机会',
    type: 'NEW_CONTENT',
    language: 'zh-CN',
    targetKeyword: 'DeepSeek 私有化部署 性能调优',
    category: 'AI实践案例',
    riskLevel: 'LOW',
    estimatedMonthlyVisitsGain: 2800,
    demandEvidence: {
      sourceType: 'GSC_QUERY',
      queryOrTopic: 'deepseek 私有化 部署 显存优化',
      monthlyImpressions: 14200,
      currentClicks: 120,
      currentPosition: 18.4,
      evidenceDescription: 'GSC 显示该关键词近 30 天展现量增长 340%，站内尚无专门的长文深度评测。',
      reliabilityConfidence: 0.96
    },
    scoreBreakdown: {
      businessValue: 19,
      searchDemand: 17,
      winProbability: 14,
      currentRanking: 10,
      engagementPotential: 9,
      googleBaiduReuse: 9,
      internalLinkValue: 5,
      freshness: 5,
      dataReliability: 5,
      riskPenalty: 0,
      costPenalty: 1,
      totalScore: 92
    },
    status: 'READY_TO_PUBLISH',
    createdAt: '2026-08-01T09:30:00Z',
    updatedAt: '2026-08-02T14:10:00Z'
  },
  {
    id: 'opp-102',
    siteId: 'site-1',
    title: '高展现低点击页面“2026 年微服务网关选型指南”的 Title 与 Meta 描述优化',
    type: 'HIGH_IMPRESSION_LOW_CTR',
    language: 'zh-CN',
    targetKeyword: '微服务网关 选型对比 2026',
    category: '企业架构指南',
    riskLevel: 'MEDIUM',
    estimatedMonthlyVisitsGain: 1800,
    demandEvidence: {
      sourceType: 'GSC_QUERY',
      queryOrTopic: '微服务网关 选型',
      monthlyImpressions: 28900,
      currentClicks: 310,
      currentPosition: 6.2,
      evidenceDescription: '排名第 6 位但点击率仅 1.07%（同等排名均值为 3.8%）。因属于已有核心文章，需要人工审批。',
      reliabilityConfidence: 0.94
    },
    scoreBreakdown: {
      businessValue: 18,
      searchDemand: 18,
      winProbability: 15,
      currentRanking: 12,
      engagementPotential: 9,
      googleBaiduReuse: 8,
      internalLinkValue: 4,
      freshness: 4,
      dataReliability: 5,
      riskPenalty: 5,
      costPenalty: 0,
      totalScore: 88
    },
    status: 'MANUAL_REVIEW',
    requiresManualReviewReason: '已有核心文章的 Title/Meta 优化需要人工审核，避免修改原高排名权重词。',
    createdAt: '2026-07-28T11:00:00Z',
    updatedAt: '2026-08-01T16:00:00Z'
  },
  {
    id: 'opp-103',
    siteId: 'site-1',
    title: '针对“RAG 检索增强生成长文本分块策略”补充新文章并增强集群内链',
    type: 'NEW_CONTENT',
    language: 'zh-CN',
    targetKeyword: 'RAG 长文本分块 策略 评估',
    category: 'AI实践案例',
    riskLevel: 'LOW',
    estimatedMonthlyVisitsGain: 1950,
    demandEvidence: {
      sourceType: 'CONTENT_GAP',
      queryOrTopic: 'rag text chunking best practices',
      monthlyImpressions: 9800,
      currentClicks: 85,
      currentPosition: 22.1,
      evidenceDescription: '客户知识库与行业问答中高频出现，现有 3 篇 RAG 文章缺少“Chunking”分支内链节点。',
      reliabilityConfidence: 0.92
    },
    scoreBreakdown: {
      businessValue: 18,
      searchDemand: 16,
      winProbability: 14,
      currentRanking: 8,
      engagementPotential: 9,
      googleBaiduReuse: 9,
      internalLinkValue: 5,
      freshness: 4,
      dataReliability: 4,
      riskPenalty: 0,
      costPenalty: 1,
      totalScore: 86
    },
    status: 'APPROVED',
    createdAt: '2026-08-02T08:15:00Z',
    updatedAt: '2026-08-02T08:15:00Z'
  },
  {
    id: 'opp-104',
    siteId: 'site-1',
    title: '处理“Postgres vs MySQL 2024”文章流量衰退（Content Decay）并刷新 2026 架构实战',
    type: 'CONTENT_DECAY',
    language: 'zh-CN',
    targetKeyword: 'PostgreSQL vs MySQL 性能选型 2026',
    category: '企业架构指南',
    riskLevel: 'MEDIUM',
    estimatedMonthlyVisitsGain: 2100,
    demandEvidence: {
      sourceType: 'IMPRESSION_DECAY',
      queryOrTopic: 'postgres mysql 对比 选型',
      monthlyImpressions: 18500,
      currentClicks: 240,
      currentPosition: 14.5,
      evidenceDescription: '近 90 天流量下滑 42%，版本信息停留在 2024 年，更新后预计可重新夺回前 5 排名。',
      reliabilityConfidence: 0.95
    },
    scoreBreakdown: {
      businessValue: 17,
      searchDemand: 16,
      winProbability: 13,
      currentRanking: 10,
      engagementPotential: 8,
      googleBaiduReuse: 8,
      internalLinkValue: 4,
      freshness: 5,
      dataReliability: 5,
      riskPenalty: 3,
      costPenalty: 1,
      totalScore: 82
    },
    status: 'MANUAL_REVIEW',
    requiresManualReviewReason: '涉及修改现有已发布老文章内容，需人工审核增删条款。',
    createdAt: '2026-07-25T14:20:00Z',
    updatedAt: '2026-07-29T10:00:00Z'
  },
  {
    id: 'opp-105',
    siteId: 'site-1',
    title: '消解“LangChain 教程”与“LangChain 部署”页面的关键词关键词自相残杀（Cannibalization）',
    type: 'CONTENT_CANNIBALIZATION',
    language: 'zh-CN',
    targetKeyword: 'LangChain 实战教程',
    category: 'AI实践案例',
    riskLevel: 'MEDIUM',
    estimatedMonthlyVisitsGain: 1200,
    demandEvidence: {
      sourceType: 'CANNIBALIZATION_ALERT',
      queryOrTopic: 'langchain 实战教程',
      competingUrls: [
        'https://techpulse.media/langchain-tutorial-2025/',
        'https://techpulse.media/langchain-deployment-guide/'
      ],
      evidenceDescription: 'Google Search Console 显示两个 URL 频繁竞争同一搜索词，排名在 11-16 名间反复轮换。建议重构锚文本与内链关系。',
      reliabilityConfidence: 0.91
    },
    scoreBreakdown: {
      businessValue: 16,
      searchDemand: 15,
      winProbability: 13,
      currentRanking: 9,
      engagementPotential: 8,
      googleBaiduReuse: 8,
      internalLinkValue: 5,
      freshness: 4,
      dataReliability: 4,
      riskPenalty: 4,
      costPenalty: 1,
      totalScore: 79
    },
    status: 'PROPOSED',
    createdAt: '2026-08-01T15:40:00Z',
    updatedAt: '2026-08-01T15:40:00Z'
  },
  {
    id: 'opp-201',
    siteId: 'site-2',
    title: 'New Guide: "Kubernetes Multi-Cluster Traffic Routing with Cilium ClusterMesh"',
    type: 'NEW_CONTENT',
    language: 'en',
    targetKeyword: 'Kubernetes Cilium ClusterMesh routing tutorial',
    category: 'Kubernetes Tutorials',
    riskLevel: 'LOW',
    estimatedMonthlyVisitsGain: 3200,
    demandEvidence: {
      sourceType: 'GSC_QUERY',
      queryOrTopic: 'cilium clustermesh multi cluster routing',
      monthlyImpressions: 22400,
      currentClicks: 210,
      currentPosition: 16.2,
      evidenceDescription: 'High US/EU search volume in GSC with zero exact-match comprehensive guides on site.',
      reliabilityConfidence: 0.97
    },
    scoreBreakdown: {
      businessValue: 20,
      searchDemand: 18,
      winProbability: 15,
      currentRanking: 11,
      engagementPotential: 9,
      googleBaiduReuse: 7,
      internalLinkValue: 5,
      freshness: 5,
      dataReliability: 5,
      riskPenalty: 0,
      costPenalty: 1,
      totalScore: 94
    },
    status: 'CALIBRATING',
    createdAt: '2026-08-02T02:00:00Z',
    updatedAt: '2026-08-02T11:20:00Z'
  }
];

export const initialDrafts: ArticleDraft[] = [
  {
    id: 'draft-101',
    opportunityId: 'opp-101',
    siteId: 'site-1',
    title: '企业级 DeepSeek 私有化部署实战：从 vLLM 显存优化到量化推理性能调优',
    language: 'zh-CN',
    category: 'AI实践案例',
    wordCount: 3240,
    searchIntent: 'INFORMATIONAL',
    evergreenStatus: 'PEAK_RANKING',
    lastEvergreenRefreshAt: '2026-08-18T10:00:00Z',
    status: 'PUBLISHED',
    publishedUrl: 'https://techpulse.media/deepseek-private-deployment-tuning-2026/',
    publishedAt: '2026-08-02T14:15:00Z',
    wpPostId: 10482,
    indexingPushStatus: {
      baiduPushed: true,
      baiduQuotaLeft: 2984,
      indexNowBroadcasted: true,
      googleSitemapPinged: true,
      pushedTimestamp: '2026-08-02T14:15:20Z',
      responseStatus: '200 OK (实时收录推送成功)'
    },
    summary: '本文深入探讨企业在私有化环境中部署 DeepSeek R1/V3 模型时的核心痛点，包括多卡显存分配、vLLM/SGLang 框架对比、FP8 量化损失评估以及生产环境并发吞吐优化方案。',
    contentHtml: `
      <h2>引言：企业私有化部署 DeepSeek 的算力挑战</h2>
      <p>随着 DeepSeek 开源模型在企业业务中的深度应用，如何在有限的私有 GPU 集群（如 8x A100 或 8x H800）中榨干算力性能，成为技术团队的核心议题。</p>
      
      <h2>一、部署框架选择：vLLM vs SGLang 对比评测</h2>
      <p>在 2026 年的生产实践中，vLLM 凭借 PagedAttention 机制与完备的 OpenAI 兼容接口仍是主流选择，但在高并发 Prefix Caching 场景下，SGLang 表现出 15%-25% 的吞吐优势。</p>
      
      <h2>二、显存优化三大杀招</h2>
      <ul>
        <li><strong>KV Cache 动态伸缩：</strong>配置 gpu_memory_utilization 为 0.92，搭配 Chunked Prefill 避免峰值 OOM。</li>
        <li><strong>FP8 量化部署：</strong>相比 16-bit 权重，FP8 在几乎无精度损失的情况下降低 48% 显存占用。</li>
        <li><strong>Tensor Parallelism 与 Pipeline Parallelism 最佳配比：</strong>针对 671B 混专家模型推荐 TP=8, PP=2。</li>
      </ul>

      <h2>三、生产环境测试与可观测性</h2>
      <p>结合 Prometheus 与 Grafana 监控 <code>vllm:num_requests_waiting</code> 与 <code>vllm:gpu_cache_usage_perc</code> 指标，确保服务 P99 延迟稳定在 350ms 以内。</p>
    `,
    sourcesUsed: [
      '客户知识库: 《2026 企业AI私有化算力白皮书.pdf》',
      '官方可信来源: vLLM v0.7.2 Performance Benchmarks',
      '官方可信来源: DeepSeek V3 Architecture & FP8 Optimization Specs'
    ],
    qualityGate: {
      passed: true,
      overallScore: 97,
      factReliabilityScore: 98,
      hallucinationFree: true,
      languageMatch: true,
      sourceCheckPassed: true,
      duplicateContentCheck: true,
      issues: [],
      passedChecks: [
        '事实可信度：98 分（无虚构性能指标或虚假版本号）',
        '知识库追溯：100% 引用的配置参数均有文档归属',
        '单语言一致性：全篇符合 zh-CN 技术写作规范',
        '重复度检测：与站内既有文章相似度 1.8%（极度独创）',
        '自动发布白名单准入：属于 [AI实践案例] 许可分类'
      ]
    },
    createdAt: '2026-08-02T10:00:00Z'
  },
  {
    id: 'draft-102',
    opportunityId: 'opp-103',
    siteId: 'site-1',
    title: 'RAG 检索增强生成架构演进：长文本递归分块与重排序（Re-ranking）工程实践',
    language: 'zh-CN',
    category: 'AI实践案例',
    wordCount: 2890,
    searchIntent: 'COMMERCIAL_INVESTIGATION',
    evergreenStatus: 'RE_OPTIMIZED_2026',
    lastEvergreenRefreshAt: '2026-08-19T14:30:00Z',
    status: 'PUBLISHED',
    publishedUrl: 'https://techpulse.media/rag-chunking-reranking-guide-2026/',
    publishedAt: '2026-08-01T10:00:00Z',
    wpPostId: 10476,
    indexingPushStatus: {
      baiduPushed: true,
      baiduQuotaLeft: 2985,
      indexNowBroadcasted: true,
      googleSitemapPinged: true,
      pushedTimestamp: '2026-08-01T10:00:15Z',
      responseStatus: '200 OK (百度+IndexNow秒推已索引)'
    },
    summary: '针对 RAG 知识问答召回不准的核心痛点，详述 Parent-Document 递归切分、BGE-Reranker-v2 深度重排与语义去重的工业级调优策略。',
    contentHtml: `
      <h2>前言：为什么朴素 RAG 无法满足企业级问答需求</h2>
      <p>固定长度切分（如 512 tokens）极易切断跨段落逻辑上下文。2026 年的主流方案全面转向<strong>语义级分块与父子文档索引</strong>。</p>
      <h2>一、Parent-Document 分块拓扑原理</h2>
      <p>通过大块保持上下文完整性，小块用于密集向量召回，命中后自动映射回父节点。</p>
    `,
    sourcesUsed: [
      '客户知识库: 《企业私有化知识库问答构建指南》',
      '官方可信来源: LangChain / LlamaIndex 2026 Architecture Best Practices'
    ],
    qualityGate: {
      passed: true,
      overallScore: 95,
      factReliabilityScore: 96,
      hallucinationFree: true,
      languageMatch: true,
      sourceCheckPassed: true,
      duplicateContentCheck: true,
      issues: [],
      passedChecks: [
        'E-E-A-T 深度评分 95 分',
        '包含完备的代码段与架构拓扑说明',
        '通过 Google/百度搜索白皮书质量校验'
      ]
    },
    createdAt: '2026-08-01T08:00:00Z'
  },
  {
    id: 'draft-201',
    opportunityId: 'opp-201',
    siteId: 'site-2',
    title: 'Kubernetes Multi-Cluster Traffic Routing with Cilium ClusterMesh: Complete 2026 Guide',
    language: 'en',
    category: 'Kubernetes Tutorials',
    wordCount: 3450,
    searchIntent: 'INFORMATIONAL',
    evergreenStatus: 'PEAK_RANKING',
    lastEvergreenRefreshAt: '2026-08-19T18:00:00Z',
    status: 'PUBLISHED',
    publishedUrl: 'https://globalcloudarch.io/cilium-clustermesh-routing-tutorial/',
    publishedAt: '2026-08-02T11:20:00Z',
    wpPostId: 8840,
    indexingPushStatus: {
      baiduPushed: false,
      baiduQuotaLeft: 0,
      indexNowBroadcasted: true,
      googleSitemapPinged: true,
      pushedTimestamp: '2026-08-02T11:20:10Z',
      responseStatus: '200 OK (Google IndexNow Instant Broadcast)'
    },
    summary: 'A deep architectural dive into setting up zero-trust cross-cluster service discovery and eBPF-based L4/L7 routing across multi-cloud Kubernetes clusters using Cilium ClusterMesh.',
    contentHtml: `
      <h2>Introduction: The Multi-Cluster Challenge in 2026</h2>
      <p>Modern hybrid-cloud architectures require seamless pod-to-pod communication without heavy encapsulation overlays.</p>
      <h2>Step 1: Enabling eBPF Global Services</h2>
      <p>By leveraging Cilium's native eBPF data path, routing latency drops by 32% compared to traditional IPsec/WireGuard tunnels.</p>
    `,
    sourcesUsed: [
      'Official Documentation: Cilium v1.16 ClusterMesh RFC',
      'Benchmark: Cloud Native Computing Foundation (CNCF) Networking Report'
    ],
    qualityGate: {
      passed: true,
      overallScore: 98,
      factReliabilityScore: 99,
      hallucinationFree: true,
      languageMatch: true,
      sourceCheckPassed: true,
      duplicateContentCheck: true,
      issues: [],
      passedChecks: [
        'E-E-A-T score 98/100 (Google Helpful Content Compliant)',
        'Zero hallucinated CLI flags',
        'Native English technical writing standard'
      ]
    },
    createdAt: '2026-08-02T10:00:00Z'
  }
];

export const initialKnowledgeSources: KnowledgeSource[] = [
  {
    id: 'kb-1',
    siteId: 'site-1',
    title: '《2026 企业AI私有化算力白皮书与部署规范》',
    type: 'CLIENT_KB',
    contentSnippet: '规范包含 DeepSeek、Llama3 私有化部署基准案例、vLLM 参数调优指导、信创 GPU 兼容矩阵与安全隔离方案。',
    urlOrFilename: 'https://techpulse.media/docs/ai-benchmark-2026.pdf',
    addedAt: '2026-01-20T10:00:00Z'
  },
  {
    id: 'kb-2',
    siteId: 'site-1',
    title: '【可信来源白名单】vLLM & Kubernetes 官方更新日志与 RFC',
    type: 'WHITELISTED_DOMAIN',
    contentSnippet: '仅允许引用 vllm.ai, kubernetes.io, deepseek.com 官方技术博客及认证论文。',
    urlOrFilename: 'https://vllm.ai/blog',
    addedAt: '2026-02-01T12:00:00Z'
  }
];

export const initialAuditLogs: AuditLogItem[] = [
  {
    id: 'log-101',
    siteId: 'site-1',
    timestamp: '2026-08-02T14:10:00Z',
    actor: 'SYSTEM_AUTOPILOT',
    action: 'RUN_QUALITY_GATE',
    target: '文章: 企业级 DeepSeek 私有化部署实战',
    result: 'SUCCESS',
    details: '质检评分 94 分，事实可靠度 96 分。符合自动发布白名单规则，准备执行推送。'
  },
  {
    id: 'log-102',
    siteId: 'site-1',
    timestamp: '2026-08-01T16:00:00Z',
    actor: 'POLICY_ENGINE',
    action: 'FLAG_MANUAL_REVIEW',
    target: '机会: 微服务网关选型指南 Title 优化',
    result: 'WARNING',
    details: '拦截原因：涉及对已发布核心文章（P0 Landing Page）的修改，按安全策略转交人工审核。'
  },
  {
    id: 'log-103',
    siteId: 'site-1',
    timestamp: '2026-08-01T09:30:00Z',
    actor: 'SYSTEM_AUTOPILOT',
    action: 'GSC_DEMAND_SCAN',
    target: 'GSC 接口与 Sitemap',
    result: 'SUCCESS',
    details: '发现 14 个新搜索意图集群，自动创建 3 个通过低风险质检的新文章机会。'
  }
];

export const initialUsageLedger: UsageLedgerItem[] = [
  {
    month: '2026-08',
    aiTokenCost: 18.2,
    crawlerCost: 4.5,
    publishedArticlesCount: 6,
    costPerArticle: 3.78,
    costPerIndexedPage: 4.12,
    budgetLimit: 150,
    budgetUsed: 38.5
  },
  {
    month: '2026-07',
    aiTokenCost: 32.4,
    crawlerCost: 8.1,
    publishedArticlesCount: 11,
    costPerArticle: 3.68,
    costPerIndexedPage: 3.95,
    budgetLimit: 150,
    budgetUsed: 40.5
  }
];

export const initialBaiduLogs: BaiduSubmissionLog[] = [
  {
    id: 'baidu-1',
    url: 'https://techpulse.media/deepseek-private-deployment-guide/',
    submittedAt: '2026-08-02T14:15:00Z',
    type: 'DAILY_API',
    status: 'INDEXED',
    remainQuota: 92
  },
  {
    id: 'baidu-2',
    url: 'https://techpulse.media/rag-chunking-strategy-2026/',
    submittedAt: '2026-08-01T10:00:00Z',
    type: 'DAILY_API',
    status: 'SUBMITTED',
    remainQuota: 93
  }
];
