import { describe, expect, it } from 'vitest';
import { resolveSeoMarket } from './seoMarket';

describe('SEO market inference', () => {
  it('uses mainland China and normalized Chinese for a .cn site', () => {
    expect(resolveSeoMarket({ domain: 'https://example.com.cn', language: 'zh-CN', defaultLocationCode: 2840 }))
      .toEqual({ locationCode: 2156, languageCode: 'zh_CN', source: 'DOMAIN_AND_LANGUAGE' });
  });

  it('uses the site language with the platform location for a generic domain', () => {
    expect(resolveSeoMarket({ domain: 'example.com', language: 'en-US', defaultLocationCode: 2840 }))
      .toEqual({ locationCode: 2840, languageCode: 'en', source: 'PLATFORM_DEFAULT' });
  });

  it('selects the United Kingdom for a co.uk site', () => {
    expect(resolveSeoMarket({ domain: 'example.co.uk', language: 'en-US', defaultLocationCode: 2840 }).locationCode).toBe(2826);
  });
});
