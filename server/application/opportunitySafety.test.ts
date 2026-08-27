import { describe, expect, it } from 'vitest';
import { hasExistingTopic } from './opportunitySafety';

describe('opportunity safety', () => {
  it('normalizes equivalent keyword spelling and prevents cannibalization', () => {
    const opportunities = [{ siteId: 'site-1', targetKeyword: 'Kubernetes FinOps：成本优化', status: 'AUTO_PUBLISHED' }] as any;

    expect(hasExistingTopic(opportunities, 'site-1', 'kubernetes finops 成本优化')).toBe(true);
    expect(hasExistingTopic(opportunities, 'site-2', 'kubernetes finops 成本优化')).toBe(false);
  });

  it('allows a rejected run to be improved and retried', () => {
    const opportunities = [{ siteId: 'site-1', targetKeyword: '企业 SEO', status: 'REJECTED' }] as any;

    expect(hasExistingTopic(opportunities, 'site-1', '企业SEO')).toBe(false);
  });
});
