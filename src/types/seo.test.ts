import { describe, expect, it } from 'vitest';
import { AUTOMATION_PIPELINE_STAGE_COUNT, AUTOMATION_PIPELINE_STAGES } from './seo';

describe('automation pipeline contract', () => {
  it('keeps the customer-visible cruise flow at eight ordered stages', () => {
    expect(AUTOMATION_PIPELINE_STAGE_COUNT).toBe(8);
    expect(AUTOMATION_PIPELINE_STAGES.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(AUTOMATION_PIPELINE_STAGES.map(({ title }) => title)).toEqual([
      '意图挖掘',
      '知识检索',
      '大纲策划',
      '长文智造',
      '质量核验',
      '智能内链',
      '站点发布',
      '引擎推送'
    ]);
  });
});
