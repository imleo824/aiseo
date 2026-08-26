import { describe, expect, it } from 'vitest';
import { nextTaskRunAt, validateScheduleTime } from './taskSchedule';

describe('task schedule calculation', () => {
  it('uses the requested daily clock time instead of a fixed 24-hour delay', () => {
    const now = new Date(2026, 7, 26, 8, 30);
    expect(nextTaskRunAt('DAILY', '09:00', now)).toEqual(new Date(2026, 7, 26, 9, 0));
    expect(nextTaskRunAt('DAILY', '08:00', now)).toEqual(new Date(2026, 7, 27, 8, 0));
  });

  it('uses a 12-hour interval cadence and rejects malformed clock times', () => {
    const now = new Date(2026, 7, 26, 8, 30);
    expect(nextTaskRunAt('INTERVAL', '09:00', now)).toEqual(new Date(2026, 7, 26, 20, 30));
    expect(() => validateScheduleTime('24:00')).toThrow('HH:mm');
  });
});
