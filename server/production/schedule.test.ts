import { describe, expect, it } from 'vitest';
import { nextAutomationRun } from './schedule';

describe('nextAutomationRun', () => {
  it('keeps the customer wall-clock time across daylight-saving changes', () => {
    const current = new Date('2026-03-07T14:00:00.000Z'); // 09:00 America/New_York
    const next = nextAutomationRun(current, 'DAILY', { time: '09:00', timezone: 'America/New_York' }, current);
    expect(next.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('skips missed calendar occurrences instead of creating a backlog storm', () => {
    const current = new Date('2026-03-01T01:00:00.000Z');
    const next = nextAutomationRun(current, 'DAILY', { time: '09:00', timezone: 'Asia/Shanghai' }, new Date('2026-03-03T02:00:00.000Z'));
    expect(next.toISOString()).toBe('2026-03-04T01:00:00.000Z');
  });

  it('validates and advances interval schedules from the later clock', () => {
    expect(nextAutomationRun(new Date('2026-03-01T00:00:00.000Z'), 'INTERVAL', { minutes: 60 }, new Date('2026-03-01T01:00:00.000Z')).toISOString()).toBe('2026-03-01T02:00:00.000Z');
  });
});
