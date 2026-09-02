import { GrowthActionType } from '@prisma/client';
import type { GscRow } from './growthEngine';

export type GrowthActionSelection = {
  type: GrowthActionType;
  riskLevel: 'A' | 'B';
  reason: string;
  mutatesWordPress: boolean;
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

export const selectGrowthAction = (input: {
  robotsBlocksAll: boolean;
  target?: { contentLength: number; modifiedAt?: string };
  targetUrl?: string;
  gscRows?: GscRow[];
  relevantInternalLinkCount: number;
  now?: Date;
}): GrowthActionSelection => {
  if (input.robotsBlocksAll) return {
    type: GrowthActionType.DIAGNOSE_ONLY,
    riskLevel: 'A',
    reason: 'robots.txt 阻止全站抓取，内容修改无法解决该服务器级问题',
    mutatesWordPress: false
  };
  if (!input.target || !input.targetUrl) return {
    type: GrowthActionType.CREATE_CONTENT,
    riskLevel: 'B',
    reason: '站内没有同主题页面，创建新页面可避免关键词蚕食',
    mutatesWordPress: true
  };

  const matchingRows = (input.gscRows || []).filter((row) => row.keys[1] === input.targetUrl);
  const impressions = matchingRows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = matchingRows.reduce((sum, row) => sum + row.clicks, 0);
  if (impressions >= 100 && clicks / impressions < 0.02) return {
    type: GrowthActionType.UPDATE_TITLE,
    riskLevel: 'B',
    reason: '该页面已有高曝光但点击率低，最小有效动作是优化标题',
    mutatesWordPress: true
  };
  if (input.target.contentLength < 1_200) return {
    type: GrowthActionType.ADD_CONTENT_SECTION,
    riskLevel: 'B',
    reason: '已有页面覆盖不足，优先增补缺失内容而不是新建重复页面',
    mutatesWordPress: true
  };
  const modifiedAt = input.target.modifiedAt ? new Date(input.target.modifiedAt) : null;
  const now = input.now || new Date();
  if (modifiedAt && Number.isFinite(modifiedAt.getTime()) && now.getTime() - modifiedAt.getTime() >= 180 * 86_400_000) return {
    type: GrowthActionType.CONTENT_REFRESH,
    riskLevel: 'B',
    reason: '已有页面超过 180 天未更新，执行基于当前 SERP 的内容刷新',
    mutatesWordPress: true
  };
  if (input.relevantInternalLinkCount > 0) return {
    type: GrowthActionType.ADD_INTERNAL_LINKS,
    riskLevel: 'A',
    reason: '现有内容仍新且覆盖充分，最小有效动作是补充相关内部链接',
    mutatesWordPress: true
  };
  return {
    type: GrowthActionType.CONTENT_REFRESH,
    riskLevel: 'B',
    reason: '已有页面需要按当前搜索意图刷新，且没有更小的可验证动作',
    mutatesWordPress: true
  };
};

export const continuousCadenceDays = (consecutiveWins: number): number => consecutiveWins >= 3 ? 3.5 : 7;
