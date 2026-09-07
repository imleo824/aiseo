export type GscRow = {
  keys: [string, string, string?, string?];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscComparisonWindow = {
  current: { startDate: string; endDate: string };
  previous: { startDate: string; endDate: string };
  periodDays: number;
};

export type GscOpportunitySeed = {
  keyword: string;
  rank: number;
  rankingUrl: string;
  impressions: number;
  sources: Array<'GSC_RANK_11_20' | 'GSC_LOW_CTR' | 'GSC_CONTENT_DECAY'>;
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const gscComparisonWindow = (startDate: string, endDate: string): GscComparisonWindow | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - (periodDays - 1) * 86_400_000);
  const date = (value: Date) => value.toISOString().slice(0, 10);
  return {
    current: { startDate, endDate },
    previous: { startDate: date(previousStart), endDate: date(previousEnd) },
    periodDays
  };
};

export const readGscRows = (payload: unknown): GscRow[] => {
  const rows = (payload as { rows?: unknown[] } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): GscRow[] => {
    const value = row as Partial<GscRow>;
    if (!Array.isArray(value.keys) || value.keys.length < 2 || !value.keys[0] || !value.keys[1]) return [];
    if (![value.clicks, value.impressions, value.ctr, value.position].every(finite)) return [];
    if ((value.impressions as number) < 0 || (value.clicks as number) < 0 || (value.position as number) <= 0) return [];
    return [{
      keys: [String(value.keys[0]), String(value.keys[1]), value.keys[2] ? String(value.keys[2]) : undefined, value.keys[3] ? String(value.keys[3]) : undefined],
      clicks: value.clicks as number,
      impressions: value.impressions as number,
      ctr: value.ctr as number,
      position: value.position as number
    }];
  });
};

type AggregatedGscPageQuery = {
  keyword: string;
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  ctr: number;
};

const aggregateByQueryPage = (rows: GscRow[]): AggregatedGscPageQuery[] => {
  const grouped = new Map<string, Omit<AggregatedGscPageQuery, 'position' | 'ctr'> & { weightedPosition: number }>();
  for (const row of rows) {
    const keyword = row.keys[0].trim();
    const url = row.keys[1].trim();
    if (!keyword || !url) continue;
    const key = `${keyword.toLocaleLowerCase().normalize('NFKC')}\n${url}`;
    const current = grouped.get(key) || { keyword, url, clicks: 0, impressions: 0, weightedPosition: 0 };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedPosition += row.position * row.impressions;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({
    keyword: row.keyword,
    url: row.url,
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.impressions > 0 ? row.weightedPosition / row.impressions : 100,
    ctr: row.impressions > 0 ? row.clicks / row.impressions : 0
  }));
};

const expectedCtr = (position: number): number => {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.14;
  if (position <= 5) return 0.08;
  if (position <= 10) return 0.035;
  return 0.015;
};

const isBrandQuery = (query: string, brandTerms: string[]): boolean => {
  const normalized = query.toLocaleLowerCase().normalize('NFKC');
  return brandTerms.some((term) => {
    const brand = term.toLocaleLowerCase().normalize('NFKC').trim();
    return brand.length >= 2 && normalized.includes(brand);
  });
};

export const extractGscOpportunitySeeds = (input: {
  current: GscRow[];
  previous?: GscRow[];
  brandTerms?: string[];
}): GscOpportunitySeed[] => {
  const current = aggregateByQueryPage(input.current)
    .filter(({ keyword }) => !isBrandQuery(keyword, input.brandTerms || []));
  const previous = new Map(aggregateByQueryPage(input.previous || [])
    .map((row) => [`${row.keyword.toLocaleLowerCase().normalize('NFKC')}\n${row.url}`, row]));
  const seeds = new Map<string, GscOpportunitySeed>();

  for (const row of current) {
    const sources: GscOpportunitySeed['sources'] = [];
    if (row.position >= 11 && row.position <= 20 && row.impressions >= 50) sources.push('GSC_RANK_11_20');
    if (row.impressions >= 100 && row.ctr < expectedCtr(row.position) * 0.65) sources.push('GSC_LOW_CTR');
    const earlier = previous.get(`${row.keyword.toLocaleLowerCase().normalize('NFKC')}\n${row.url}`);
    if (earlier && earlier.clicks >= 10 && row.clicks <= earlier.clicks * 0.7) sources.push('GSC_CONTENT_DECAY');
    if (!sources.length) continue;
    const key = row.keyword.toLocaleLowerCase().normalize('NFKC');
    const existing = seeds.get(key);
    if (!existing || row.impressions > existing.impressions) {
      seeds.set(key, { keyword: row.keyword, rank: row.position, rankingUrl: row.url, impressions: row.impressions, sources });
    } else {
      existing.sources = [...new Set([...existing.sources, ...sources])];
    }
  }

  return [...seeds.values()].sort((left, right) =>
    right.impressions - left.impressions || left.keyword.localeCompare(right.keyword)
  );
};
