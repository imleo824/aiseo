export type SeoMarket = {
  locationCode: number;
  languageCode: string;
  source: 'GSC_COUNTRY' | 'COUNTRY_DOMAIN' | 'SITE_LOCALE' | 'PLATFORM_DEFAULT';
  confidence: number;
  evidence: string[];
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

const LOCATION_BY_REGION: Record<string, number> = {
  CN: 2156,
  HK: 2344,
  TW: 2158,
  SG: 2702,
  AU: 2036,
  GB: 2826,
  UK: 2826,
  CA: 2124,
  US: 2840
};

const NORMALIZED_GSC_COUNTRY: Record<string, string> = {
  CHN: 'CN', HKG: 'HK', TWN: 'TW', SGP: 'SG', AUS: 'AU', GBR: 'GB', CAN: 'CA', USA: 'US'
};

const normalizedGscCountry = (value: string): string => {
  const country = value.trim().toLocaleUpperCase();
  return NORMALIZED_GSC_COUNTRY[country] || country;
};

const regionFromLocale = (locale: string): string | undefined => {
  const parts = locale.replace('_', '-').split('-');
  return parts.length > 1 ? parts.at(-1)?.toLocaleUpperCase() : undefined;
};

export const resolveSeoMarket = (input: {
  domain: string;
  language: string;
  defaultLocationCode: number;
  siteLocale?: string;
  hreflangLocales?: string[];
  gscCountries?: Array<{ country: string; impressions: number }>;
}): SeoMarket => {
  let hostname = input.domain.trim().toLocaleLowerCase();
  try {
    hostname = new URL(/^https?:\/\//i.test(hostname) ? hostname : `https://${hostname}`).hostname;
  } catch {
    // Site creation performs its own domain validation. A malformed legacy
    // hostname is still handled deterministically through the platform market.
  }
  const match = MARKET_BY_SUFFIX.find(({ suffix }) => hostname.endsWith(suffix));
  const dominantGscCountry = [...(input.gscCountries || [])]
    .map(({ country, impressions }) => ({ country: normalizedGscCountry(country), impressions }))
    .filter(({ country, impressions }) => /^[A-Z]{2}$/i.test(country) && impressions > 0 && LOCATION_BY_REGION[country])
    .sort((left, right) => right.impressions - left.impressions)[0];
  if (dominantGscCountry) {
    return {
      locationCode: LOCATION_BY_REGION[dominantGscCountry.country.toLocaleUpperCase()],
      languageCode: normalizedLanguage(input.siteLocale || input.language),
      source: 'GSC_COUNTRY',
      confidence: 0.95,
      evidence: ['GSC dominant country: ' + dominantGscCountry.country.toLocaleUpperCase()]
    };
  }
  if (match) {
    return {
      locationCode: match.locationCode,
      languageCode: match.languageCode || normalizedLanguage(input.siteLocale || input.language),
      source: 'COUNTRY_DOMAIN',
      confidence: 0.9,
      evidence: ['Country-code domain suffix: ' + match.suffix]
    };
  }
  const localeCandidates = [input.siteLocale, ...(input.hreflangLocales || []), input.language].filter((value): value is string => Boolean(value));
  const locale = localeCandidates.find((value) => {
    const region = regionFromLocale(value);
    return Boolean(region && LOCATION_BY_REGION[region]);
  });
  const region = locale ? regionFromLocale(locale) : undefined;
  if (locale && region) {
    return {
      locationCode: LOCATION_BY_REGION[region],
      languageCode: normalizedLanguage(locale),
      source: 'SITE_LOCALE',
      confidence: 0.8,
      evidence: ['Site locale: ' + locale]
    };
  }
  return {
    locationCode: input.defaultLocationCode,
    languageCode: normalizedLanguage(input.siteLocale || input.language),
    source: 'PLATFORM_DEFAULT',
    confidence: 0.45,
    evidence: ['No country-specific signal; deterministic platform market applied automatically']
  };
};
