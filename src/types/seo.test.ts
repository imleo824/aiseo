import { describe, expect, it } from 'vitest';
import { AUTOMATION_PIPELINE_STAGE_COUNT, AUTOMATION_PIPELINE_STAGES } from './seo';

describe('automation pipeline contract', () => {
  it('keeps the customer-visible growth flow at five ordered evidence stages', () => {
    expect(AUTOMATION_PIPELINE_STAGE_COUNT).toBe(5);
    expect(AUTOMATION_PIPELINE_STAGES.map(({ number }) => number)).toEqual([1, 2, 3, 4, 5]);
    expect(AUTOMATION_PIPELINE_STAGES.map(({ title }) => title)).toEqual([
      '了解网站',
      '发现机会',
      '选择动作',
      '执行与发布',
      '观察与学习'
    ]);
  });
});
