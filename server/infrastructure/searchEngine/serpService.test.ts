import { afterEach, describe, expect, it, vi } from 'vitest';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SERPER_API_KEY;
  delete process.env.SERPER_FREE_API_KEY;
  delete process.env.SERPER_PAID_API_KEY;
  delete process.env.GOOGLE_CSE_KEY;
  delete process.env.GOOGLE_CSE_CX;
  vi.resetModules();
});

describe('SerpService provenance-safe behavior', () => {
  it('returns actual Google suggestions but never invents volume, KD, KGR or ROI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(['billing software', ['billing software comparison', 'billing software pricing']]));
    vi.stubGlobal('fetch', fetchMock);
    const { SerpService } = await import('./serpService');

    const result = await new SerpService().scanKeywordOpportunities({ seedKeyword: 'billing software' });

    expect(result.source).toBe('FREE_GOOGLE_SUGGEST');
    expect(result.opportunities.map((item) => item.keyword)).toEqual(['billing software', 'billing software comparison', 'billing software pricing']);
    expect(result.opportunities.every((item) => item.searchVolume === 0 && item.kd === 0 && item.kgrIndex === 0 && item.roiScore === 0)).toBe(true);
  });

  it('fails closed when the available provider fails instead of emitting a synthetic keyword list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    const { SerpService } = await import('./serpService');

    await expect(new SerpService().scanKeywordOpportunities({ seedKeyword: 'billing software' })).rejects.toThrow('Google Suggest 请求失败');
  });

  it('derives only observable SERP evidence from Serper results', async () => {
    process.env.SERPER_API_KEY = 'serper-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ organic: [
      { title: 'Discussion', link: 'https://www.reddit.com/r/seo/example' },
      { title: 'Guide', link: 'https://example.com/guide' }
    ] })));
    const { SerpService } = await import('./serpService');

    const result = await new SerpService().scanKeywordOpportunities({ seedKeyword: 'billing software' });

    expect(result.source).toBe('PAID_SERP_API');
    expect(result.opportunities[0]).toMatchObject({ searchVolume: 0, kd: 0, kgrIndex: 0, roiScore: 0 });
    expect(result.opportunities[0].serpWeaknesses.join(' ')).toContain('reddit.com');
  });
});
