import { describe, expect, it } from 'vitest';
import { resolveSeoMarket } from './seoMarket';

describe('SEO market inference', () => {
  it('uses mainland China and normalized Chinese for a .cn site', () => {
    expect(resolveSeoMarket({ domain: 'https://example.com.cn', language: 'zh-CN', defaultLocationCode: 2840 }))
      .toMatchObject({ locationCode: 2156, languageCode: 'zh_CN', source: 'COUNTRY_DOMAIN', needsConfirmation: false });
  });

  it('uses the site language with the platform location for a generic domain', () => {
    expect(resolveSeoMarket({ domain: 'example.com', language: 'en-US', defaultLocationCode: 2840 }))
      .toMatchObject({ locationCode: 2840, languageCode: 'en', source: 'SITE_LOCALE', needsConfirmation: false });
  });

  it('selects the United Kingdom for a co.uk site', () => {
    expect(resolveSeoMarket({ domain: 'example.co.uk', language: 'en-US', defaultLocationCode: 2840 }).locationCode).toBe(2826);
  });

  it('accepts the three-letter country codes returned by GSC', () => {
    expect(resolveSeoMarket({ domain: 'example.com', language: 'en', defaultLocationCode: 2840, gscCountries: [{ country: 'gbr', impressions: 100 }] }))
      .toMatchObject({ locationCode: 2826, source: 'GSC_COUNTRY', confidence: 0.95 });
  });
});
