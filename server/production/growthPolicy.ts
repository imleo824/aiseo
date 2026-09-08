import { GrowthActionType } from '@prisma/client';
import type { GscRow } from './gscData';

export type GrowthActionSelection = {
  type: GrowthActionType;
  riskLevel: 'A' | 'B';
  reason: string;
  mutatesWordPress: boolean;
  fallbackReason?: string;
};

export const OPPORTUNITY_SCORE_VERSION = 'opportunity-score-4';
const MICROS = 1_000_000n;
const clampRatio = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const ratioMicros = (value: number): bigint => BigInt(Math.round(clampRatio(value) * 1_000_000));

export type SearchOpportunityScore = {
  qualified: boolean;
  reason: string;
  expectedValueMicros: bigint;
  trafficPotentialMicros: bigint;
  businessRelevanceMicros: bigint;
  successProbabilityMicros: bigint;
  confidenceMicros: bigint;
  executionCostMicros: bigint;
  riskPenaltyMicros: bigint;
  clickOpportunityMicros: bigint;
  intentFitMicros: bigint;
  siteFitMicros: bigint;
  formulaVersion: string;
};

export const scoreSearchOpportunity = (input: {
  searchVolume: number;
  keywordDifficulty: number;
  allintitleCount: number;
  hasSerpEvidence: boolean;
  businessRelevance: number;
  intentProbability: number | null;
  siteTopicFit: number;
  existingRank: number | null;
  sourceCount: number;
  cannibalizationRisk: number;
}): SearchOpportunityScore => {
  const businessRelevanceMicros = ratioMicros(input.businessRelevance);
  const intentFitMicros = ratioMicros(input.intentProbability ?? 0.55);
  const siteFitMicros = ratioMicros(input.siteTopicFit);
  const confidence = clampRatio(
    (input.hasSerpEvidence ? 0.35 : 0)
    + Math.min(0.25, input.sourceCount * 0.08)
    + (input.searchVolume > 0 ? 0.2 : 0)
    + (input.keywordDifficulty >= 0 && input.keywordDifficulty <= 100 ? 0.2 : 0)
  );
  const confidenceMicros = ratioMicros(confidence);
  const rankClickOpportunity = input.existingRank
    ? clampRatio((30 - Math.min(30, input.existingRank)) / 30)
    : 0.45;
  const clickOpportunityMicros = ratioMicros(rankClickOpportunity);
  const successProbabilityMicros = ratioMicros(
    (1 - clampRatio(input.keywordDifficulty / 100)) * 0.55
    + clampRatio(input.siteTopicFit) * 0.3
    + (input.existingRank && input.existingRank <= 30 ? 0.15 : 0.05)
  );
  const trafficPotentialMicros = BigInt(Math.max(0, Math.round(input.searchVolume))) * clickOpportunityMicros;
  const executionCostMicros = input.existingRank ? 500_000n : 1_500_000n;
  const competitionPenalty = ratioMicros(Math.min(1, Math.log10(Math.max(1, input.allintitleCount + 1)) / 7));
  const riskPenaltyMicros = ratioMicros(clampRatio(input.cannibalizationRisk)) + competitionPenalty / 2n;
  const gross = trafficPotentialMicros
    * businessRelevanceMicros / MICROS
    * intentFitMicros / MICROS
    * siteFitMicros / MICROS
    * successProbabilityMicros / MICROS
    * confidenceMicros / MICROS;
  const deductions = executionCostMicros + riskPenaltyMicros;
  const expectedValueMicros = gross > deductions ? gross - deductions : 0n;
  const qualified = input.hasSerpEvidence
    && input.searchVolume > 0
    && input.keywordDifficulty < 95
    && businessRelevanceMicros >= 250_000n
    && siteFitMicros >= 200_000n
    && confidenceMicros >= 550_000n
    && input.cannibalizationRisk < 0.8
    && expectedValueMicros > 0n;
  const reason = !input.hasSerpEvidence ? '真实 SERP 结果不可用'
    : input.searchVolume <= 0 ? '真实搜索量为 0'
      : input.keywordDifficulty >= 95 ? '关键词竞争度与当前站点不匹配'
        : businessRelevanceMicros < 250_000n ? '与网站业务相关性不足'
          : siteFitMicros < 200_000n ? '与网站现有主题关联不足'
            : confidenceMicros < 550_000n ? '数据来源不足，无法安全决策'
              : input.cannibalizationRisk >= 0.8 ? '存在高概率关键词蚕食'
                : expectedValueMicros <= 0n ? '预期价值不足以覆盖执行成本和风险'
                  : '真实需求、业务相关性、站点匹配和执行价值均达标';
  return {
    qualified,
    reason,
    expectedValueMicros,
    trafficPotentialMicros,
    businessRelevanceMicros,
    successProbabilityMicros,
    confidenceMicros,
    executionCostMicros,
    riskPenaltyMicros,
    clickOpportunityMicros,
    intentFitMicros,
    siteFitMicros,
    formulaVersion: OPPORTUNITY_SCORE_VERSION
  };
};

export const qualifySearchOpportunity = (input: {
  searchVolume: number;
  keywordDifficulty: number;
  allintitleCount: number;
  hasSerpEvidence: boolean;
}): { qualified: boolean; reason: string } => {
  if (!input.hasSerpEvidence) return { qualified: false, reason: '真实 SERP 结果不可用' };
  if (input.searchVolume <= 0) return { qualified: false, reason: '真实搜索量为 0' };
  if (input.keywordDifficulty >= 100) return { qualified: false, reason: '关键词竞争度不具备可执行空间' };
  if (input.allintitleCount < 0) return { qualified: false, reason: 'allintitle 数据无效' };
  return { qualified: true, reason: '真实需求与 SERP 证据完整' };
};

const expectedCtrForPosition = (position: number): number => {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.14;
  if (position <= 5) return 0.08;
  if (position <= 10) return 0.035;
  return 0.015;
};

const comparableUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
};

export const selectGrowthAction = (input: {
  robotsBlocksAll: boolean;
  target?: { contentLength: number; modifiedAt?: string };
  targetUrl?: string;
  gscRows?: GscRow[];
  relevantInternalLinkCount: number;
  contentCoverage?: number;
  now?: Date;
  supportsAction?: (action: GrowthActionType) => { supported: boolean; reason: string };
}): GrowthActionSelection => {
  if (input.robotsBlocksAll) return {
    type: GrowthActionType.DIAGNOSE_ONLY,
    riskLevel: 'A',
    reason: 'robots.txt 阻止全站抓取，内容修改无法解决该服务器级问题',
    mutatesWordPress: false
  };
  if (!input.target || !input.targetUrl) {
    const selected: GrowthActionSelection = {
    type: GrowthActionType.CREATE_CONTENT,
    riskLevel: 'B',
    reason: '站内没有同主题页面，创建新页面可避免关键词蚕食',
    mutatesWordPress: true
    };
    const supported = input.supportsAction?.(selected.type);
    return !supported || supported.supported ? selected : {
      type: GrowthActionType.DIAGNOSE_ONLY,
      riskLevel: 'A',
      reason: `最佳动作 CREATE_CONTENT 与当前 WordPress 能力不兼容：${supported.reason}`,
      fallbackReason: supported.reason,
      mutatesWordPress: false
    };
  }

  const normalizedTarget = comparableUrl(input.targetUrl);
  const matchingRows = (input.gscRows || []).filter((row) => comparableUrl(row.keys[1]) === normalizedTarget);
  const impressions = matchingRows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = matchingRows.reduce((sum, row) => sum + row.clicks, 0);
  const weightedPosition = impressions
    ? matchingRows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions
    : null;
  const candidates: GrowthActionSelection[] = [];
  if (impressions >= 100 && weightedPosition && clicks / impressions < expectedCtrForPosition(weightedPosition) * 0.65) candidates.push({
      type: GrowthActionType.UPDATE_TITLE,
      riskLevel: 'B',
      reason: '该页面已有高曝光但点击率低，最小有效动作是优化标题',
      mutatesWordPress: true
    });
  if ((input.contentCoverage ?? Math.min(1, input.target.contentLength / 4_000)) < 0.55) candidates.push({
      type: GrowthActionType.ADD_CONTENT_SECTION,
      riskLevel: 'B',
      reason: '已有页面覆盖不足，优先增补缺失内容而不是新建重复页面',
      mutatesWordPress: true
    });
  const modifiedAt = input.target.modifiedAt ? new Date(input.target.modifiedAt) : null;
  const now = input.now || new Date();
  if (modifiedAt && Number.isFinite(modifiedAt.getTime()) && now.getTime() - modifiedAt.getTime() >= 180 * 86_400_000) candidates.push({
      type: GrowthActionType.CONTENT_REFRESH,
      riskLevel: 'B',
      reason: '已有页面超过 180 天未更新，执行基于当前 SERP 的内容刷新',
      mutatesWordPress: true
    });
  if (input.relevantInternalLinkCount > 0) candidates.push({
      type: GrowthActionType.ADD_INTERNAL_LINKS,
      riskLevel: 'A',
      reason: '现有内容仍新且覆盖充分，最小有效动作是补充相关内部链接',
      mutatesWordPress: true
    });
  candidates.push({
      type: GrowthActionType.CONTENT_REFRESH,
      riskLevel: 'B',
      reason: '已有页面需要按当前搜索意图刷新，且没有更小的可验证动作',
      mutatesWordPress: true
    });
  const firstChoice = candidates[0];
  const selected = candidates.find((candidate) => input.supportsAction?.(candidate.type).supported !== false);
  if (selected) return selected === firstChoice ? selected : {
    ...selected,
    fallbackReason: `${firstChoice.type} 不兼容：${input.supportsAction?.(firstChoice.type).reason || '能力不可用'}`,
    reason: `${selected.reason}；已跳过不兼容动作 ${firstChoice.type}`
  };
  const reasons = [...new Set(candidates.map((candidate) => `${candidate.type}: ${input.supportsAction?.(candidate.type).reason || '能力不可用'}`))];
  return {
    type: GrowthActionType.DIAGNOSE_ONLY,
    riskLevel: 'A',
    reason: `当前页面没有可证明安全的兼容动作：${reasons.join('；')}`,
    fallbackReason: reasons.join('；'),
    mutatesWordPress: false
  };
};

export const continuousCadenceDays = (consecutiveWins: number, gscConnected = false): number =>
  gscConnected && consecutiveWins >= 3 ? 3.5 : 7;
