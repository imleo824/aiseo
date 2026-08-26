export type DataProvenance = {
  source: 'GSC' | 'DATAFORSEO';
  status: 'LIVE' | 'PENDING' | 'UNAVAILABLE' | 'STALE';
  fetchedAt: string;
  providerTaskId?: string;
  availableFrom?: string;
};

export type QualityReport = {
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  generatedAt: string;
};

export type PaymentIntentResponse = {
  id: string;
  network: 'TRC20';
  recipientAddress: string;
  expectedAmountUsdt: string;
  credits: number;
  status: string;
  expiresAt: string;
};

export const isProductionDataStatus = (value: string): value is DataProvenance['status'] =>
  value === 'LIVE' || value === 'PENDING' || value === 'UNAVAILABLE' || value === 'STALE';
