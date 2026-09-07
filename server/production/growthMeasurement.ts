import type { GscRow } from './gscData';

const DAY = 86_400_000;

const date = (value: Date): string => value.toISOString().slice(0, 10);

export const actionMeasurementWindow = (
  executedAt: Date,
  windowDays: 14 | 28 | 56,
  dataLagDays = 3
) => {
  const actionDay = new Date(Date.UTC(
    executedAt.getUTCFullYear(),
    executedAt.getUTCMonth(),
    executedAt.getUTCDate()
  ));
  const currentStart = new Date(actionDay.getTime() + DAY);
  const currentEnd = new Date(actionDay.getTime() + windowDays * DAY);
  const previousEnd = new Date(actionDay.getTime() - DAY);
  const previousStart = new Date(previousEnd.getTime() - (windowDays - 1) * DAY);
  return {
    current: { startDate: date(currentStart), endDate: date(currentEnd) },
    previous: { startDate: date(previousStart), endDate: date(previousEnd) },
    readyAt: new Date(currentEnd.getTime() + dataLagDays * DAY),
    windowDays,
    dataLagDays
  };
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

const queryIsBranded = (query: string, brandTerms: string[]): boolean => {
  const normalized = query.toLocaleLowerCase().normalize('NFKC');
  return brandTerms.some((term) => {
    const value = term.toLocaleLowerCase().normalize('NFKC').trim();
    return value.length >= 2 && normalized.includes(value);
  });
};

export type AggregatedGscMeasurement = {
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  queryCount: number;
  rowCount: number;
};

export const aggregateTargetGsc = (
  rows: GscRow[],
  targetUrl: string,
  brandTerms: string[] = []
): AggregatedGscMeasurement => {
  const target = comparableUrl(targetUrl);
  if (!target) throw new Error('GSC observation requires a valid target URL');
  const selected = rows.filter((row) =>
    comparableUrl(row.keys[1]) === target && !queryIsBranded(row.keys[0], brandTerms)
  );
  const clicks = selected.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = selected.reduce((sum, row) => sum + row.impressions, 0);
  const weightedPosition = impressions
    ? selected.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions
    : null;
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: weightedPosition,
    queryCount: new Set(selected.map((row) => row.keys[0].toLocaleLowerCase())).size,
    rowCount: selected.length
  };
};

export const evaluateGrowthOutcome = (
  current: AggregatedGscMeasurement,
  previous: AggregatedGscMeasurement
): { outcome: 'WIN' | 'NEUTRAL' | 'LOSS' | 'INCONCLUSIVE'; confidenceMicros: bigint; clickDelta: number } => {
  const clickDelta = current.clicks - previous.clicks;
  const evidenceImpressions = current.impressions + previous.impressions;
  const confidence = Math.min(1, evidenceImpressions / 2_000);
  const confidenceMicros = BigInt(Math.round(confidence * 1_000_000));
  if (current.impressions < 20 || confidence < 0.1) return { outcome: 'INCONCLUSIVE', confidenceMicros, clickDelta };
  const positionDelta = current.position !== null && previous.position !== null
    ? previous.position - current.position
    : 0;
  const impressionDelta = current.impressions - previous.impressions;
  if (clickDelta > 0 && (positionDelta >= -1 || impressionDelta > 0)) return { outcome: 'WIN', confidenceMicros, clickDelta };
  if (clickDelta < 0 && confidence >= 0.35 && positionDelta <= 0) return { outcome: 'LOSS', confidenceMicros, clickDelta };
  return { outcome: 'NEUTRAL', confidenceMicros, clickDelta };
};
