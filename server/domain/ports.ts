import { WordPressSite, ContentBrief, QualityGateResult, Language, CompetitorAttackAnalysis } from '../../src/types/seo';

export interface IWordPressPublisher {
  testConnection(site: WordPressSite): Promise<{
    connected: boolean;
    user?: string;
    siteName?: string;
    wpVersion?: string;
    message: string;
  }>;

  publishPost(
    site: WordPressSite,
    draft: {
      title: string;
      contentHtml: string;
      category?: string;
      summary?: string;
      status?: 'publish' | 'draft';
      slug?: string;
    }
  ): Promise<{
    success: boolean;
    wpPostId?: number;
    publishedUrl?: string;
    slug?: string;
    date?: string;
    rawResponse?: any;
    error?: string;
    isSimulatedFallback?: boolean;
  }>;

  deletePost(site: WordPressSite, wpPostId: number): Promise<{
    success: boolean;
    message: string;
  }>;
}

export interface ISearchEngineSubmitter {
  pushToBaidu(siteDomain: string, token?: string, urls?: string[]): Promise<{
    success: boolean;
    remain?: number;
    successCount?: number;
    message: string;
    isSimulatedFallback?: boolean;
  }>;

  pushToGoogle(siteDomain: string, urls?: string[]): Promise<{
    success: boolean;
    statusCode?: number;
    message: string;
    isSimulatedFallback?: boolean;
  }>;

  pushToIndexNow?(host: string, key?: string, urlList?: string[]): Promise<{
    success: boolean;
    statusCode?: number;
    message: string;
    isSimulatedFallback?: boolean;
  }>;
}

export interface IContentIntelligenceEngine {
  analyzeSearchDemand(keyword: string, language: Language | string, niche?: string): Promise<{
    suggestedTitle: string;
    searchIntent: string;
    competitorGaps: string[];
    recommendedH2s: string[];
    estimatedTrafficGain: number;
    schemaTypes: string[];
    lsiKeywords?: string[];
  }>;

  analyzeCompetitorGapsAndAttack(
    competitor: string,
    language: Language | string,
    niche?: string
  ): Promise<CompetitorAttackAnalysis>;

  generateContentBrief(
    opportunityId: string,
    targetKeyword: string,
    language: Language | string,
    knowledgeSnippets?: string[]
  ): Promise<ContentBrief>;

  generateArticleAndQualityCheck(
    targetKeyword: string,
    language: Language | string,
    brief?: ContentBrief,
    knowledgeSnippets?: string[]
  ): Promise<{
    title: string;
    summary: string;
    contentHtml: string;
    qualityGate: QualityGateResult;
  }>;
}
