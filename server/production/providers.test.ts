import { describe, expect, it } from 'vitest';
import { buildInstantPageBatches, collectPaginatedRows, keywordCandidateFromItem, MAX_TECHNICAL_AUDIT_PAGES, selectGscProperty, selectTechnicalAuditUrls, targetRankFromSerp, validateTrc20TransferRecord } from './providers';

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

  it('never treats a competitor ranking URL as the customer page', () => {
    expect(keywordCandidateFromItem({
      keyword_data: { keyword: 'wordpress seo', keyword_info: { search_volume: 1200 } },
      ranked_serp_element: { serp_item: { rank_group: 2, url: 'https://competitor.example/guide' } }
    }, 'COMPETITOR_RANKED_KEYWORDS')).toMatchObject({ rank: null, rankingUrl: null });
  });
});

describe('GSC property selection', () => {
  it('automatically selects the verified property matching the WordPress domain', () => {
    expect(selectGscProperty('https://blog.example.com', [
      { siteUrl: 'sc-domain:unrelated.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://blog.example.com/', permissionLevel: 'siteFullUser' },
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }
    ])).toBe('sc-domain:example.com');
  });

  it('rejects unrelated and unverified properties', () => {
    expect(selectGscProperty('example.com', [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteUnverifiedUser' },
      { siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }
    ])).toBeNull();
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

describe('DataForSEO Instant Pages request limits', () => {
  it('never sends more than five URLs from the same domain in one request', () => {
    const urls = Array.from({ length: 23 }, (_, index) => `https://example.com/page-${index}`);
    const batches = buildInstantPageBatches(urls);
    expect(batches.flat()).toEqual(urls);
    expect(batches.every((batch) => batch.length <= 5)).toBe(true);
  });

  it('packs mixed domains up to twenty tasks without exceeding the per-domain limit', () => {
    const urls = Array.from({ length: 4 }, (_, domain) =>
      Array.from({ length: 5 }, (_, page) => `https://site-${domain}.example/page-${page}`)
    ).flat();
    expect(buildInstantPageBatches(urls)).toEqual([urls]);
  });

  it('uses a deterministic bounded HTTPS sample and preserves the first URL', () => {
    const urls = Array.from({ length: MAX_TECHNICAL_AUDIT_PAGES + 10 }, (_, index) => `https://example.com/page-${index}`);
    expect(selectTechnicalAuditUrls([urls[0], urls[0], ...urls])).toEqual(urls.slice(0, MAX_TECHNICAL_AUDIT_PAGES));
    expect(() => selectTechnicalAuditUrls(['http://example.com'])).toThrow('只允许 HTTPS');
  });
});

describe('SERP target evidence', () => {
  it('matches only the exact normalized delivery URL', () => {
    const serp = { items: [
      { type: 'organic', rank_group: 7, url: 'https://www.example.com/guide/?utm_source=test' },
      { type: 'organic', rank_group: 2, url: 'https://competitor.example/guide' }
    ] };
    expect(targetRankFromSerp(serp, 'https://example.com/guide')).toBe(7);
    expect(targetRankFromSerp(serp, 'https://example.com/other')).toBeNull();
  });
});

describe('TRC20 payment evidence', () => {
  const input = {
    recipientAddress: 'TRecipient',
    expectedAmountMicros: 10_000_001n,
    notBefore: new Date('2026-09-13T00:00:00.000Z'),
    notAfter: new Date('2026-09-13T00:30:00.000Z')
  };
  const transfer = {
    transaction_id: 'a'.repeat(64),
    from: 'TSender',
    to: input.recipientAddress,
    value: input.expectedAmountMicros.toString(),
    block_timestamp: input.notBefore.getTime() + 1_000,
    token_info: { address: 'TContract' }
  };

  it('accepts only the exact recipient, contract, amount and time window', () => {
    expect(validateTrc20TransferRecord(transfer, input, 'TContract')).toMatchObject({
      transactionId: transfer.transaction_id,
      valueMicros: '10000001',
      confirmed: true
    });
  });

  it('classifies a wrong amount as a terminal customer transfer mismatch', () => {
    try {
      validateTrc20TransferRecord({ ...transfer, value: '10000002' }, input, 'TContract');
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'PAYMENT_VERIFICATION_REJECTED' });
    }
  });

  it('treats malformed provider data as a retriable provider failure', () => {
    try {
      validateTrc20TransferRecord({ ...transfer, block_timestamp: 'invalid' }, input, 'TContract');
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ errorCode: 'EXTERNAL_SERVICE_ERROR' });
    }
  });
});
