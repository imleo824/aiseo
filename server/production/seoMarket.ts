export type SeoMarket = {
  locationCode: number;
  languageCode: string;
  source: 'DOMAIN_AND_LANGUAGE' | 'PLATFORM_DEFAULT';
};

const MARKET_BY_SUFFIX: Array<{ suffix: string; locationCode: number; languageCode?: string }> = [
  { suffix: '.com.cn', locationCode: 2156, languageCode: 'zh_CN' },
  { suffix: '.cn', locationCode: 2156, languageCode: 'zh_CN' },
  { suffix: '.com.hk', locationCode: 2344, languageCode: 'zh_TW' },
  { suffix: '.hk', locationCode: 2344, languageCode: 'zh_TW' },
  { suffix: '.com.tw', locationCode: 2158, languageCode: 'zh_TW' },
  { suffix: '.tw', locationCode: 2158, languageCode: 'zh_TW' },
  { suffix: '.com.sg', locationCode: 2702 },
  { suffix: '.sg', locationCode: 2702 },
  { suffix: '.com.au', locationCode: 2036 },
  { suffix: '.au', locationCode: 2036 },
  { suffix: '.co.uk', locationCode: 2826 },
  { suffix: '.uk', locationCode: 2826 },
  { suffix: '.ca', locationCode: 2124 }
];

const normalizedLanguage = (language: string): string => {
  const value = language.replace('-', '_').toLocaleLowerCase();
  if (value === 'zh_tw' || value === 'zh_hk') return 'zh_TW';
  if (value.startsWith('zh')) return 'zh_CN';
  return 'en';
};

export const resolveSeoMarket = (input: {
  domain: string;
  language: string;
  defaultLocationCode: number;
}): SeoMarket => {
  let hostname = input.domain.trim().toLocaleLowerCase();
  try {
    hostname = new URL(/^https?:\/\//i.test(hostname) ? hostname : `https://${hostname}`).hostname;
  } catch {
    // Site creation performs its own domain validation. A malformed legacy
    // hostname is still handled deterministically through the platform market.
  }
  const match = MARKET_BY_SUFFIX.find(({ suffix }) => hostname.endsWith(suffix));
  return {
    locationCode: match?.locationCode || input.defaultLocationCode,
    languageCode: match?.languageCode || normalizedLanguage(input.language),
    source: match ? 'DOMAIN_AND_LANGUAGE' : 'PLATFORM_DEFAULT'
  };
};
