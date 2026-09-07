import { describe, expect, it } from 'vitest';
import { collectPaginatedRows, keywordCandidateFromItem } from './providers';

describe('DataForSEO response contracts', () => {
  it('parses top-level keyword suggestion metrics', () => {
    expect(keywordCandidateFromItem({
      keyword: 'wordpress seo checklist',
      keyword_info: { search_volume: 900 },
      keyword_properties: { keyword_difficulty: 31 },
      search_intent_info: { main_intent: 'informational' }
    }, 'KEYWORD_SUGGESTIONS')).toEqual({
      keyword: 'wordpress seo checklist', searchVolume: 900, keywordDifficulty: 31,
      intent: 'informational', intentProbability: null, rank: null, rankingUrl: null,
      sources: ['KEYWORD_SUGGESTIONS']
    });
  });

  it('parses ranked-keyword nesting and the dedicated intent probability contract', () => {
    expect(keywordCandidateFromItem({
      keyword_data: { keyword: 'wordpress seo', keyword_info: { search_volume: 1200 }, keyword_properties: { keyword_difficulty: 42 } },
      ranked_serp_element: { serp_item: { rank_group: 14, url: 'https://example.com/guide' } }
    }, 'SITE_RANKED_KEYWORDS')).toMatchObject({ searchVolume: 1200, keywordDifficulty: 42, rank: 14, rankingUrl: 'https://example.com/guide' });
    expect(keywordCandidateFromItem({ keyword: 'wordpress seo', keyword_intent: { label: 'commercial', probability: 0.83 } }, 'SEARCH_INTENT'))
      .toMatchObject({ intent: 'commercial', intentProbability: 0.83 });
  });
});

describe('provider pagination', () => {
  it('reads every page until the provider returns a short page', async () => {
    const starts: number[] = [];
    const rows = await collectPaginatedRows(async (startRow, rowLimit) => {
      starts.push(startRow);
      return Array.from({ length: startRow < 4 ? rowLimit : 1 }, (_, offset) => startRow + offset);
    }, 2, 10);
    expect(rows).toEqual([0, 1, 2, 3, 4]);
    expect(starts).toEqual([0, 2, 4]);
  });

  it('fails closed instead of treating a truncated maximum as complete data', async () => {
    await expect(collectPaginatedRows(async (_startRow, rowLimit) => Array.from({ length: rowLimit }, (_, index) => index), 2, 4))
      .rejects.toThrow('超过安全上限');
  });

  it('accepts an exact maximum only after verifying that no overflow row exists', async () => {
    const rows = await collectPaginatedRows(async (startRow, rowLimit) => startRow < 4
      ? Array.from({ length: rowLimit }, (_, offset) => startRow + offset)
      : [], 2, 4);
    expect(rows).toEqual([0, 1, 2, 3]);
  });
});
