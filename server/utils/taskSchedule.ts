import { ValidationError } from '../domain/errors';

export type TaskScheduleType = 'DAILY' | 'WEEKLY' | 'INTERVAL';

export const validateScheduleTime = (value: unknown): string => {
  const time = String(value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new ValidationError('执行时间必须是 HH:mm（24 小时制）');
  }
  return time;
};

/**
 * Calculate the next due time in the server's configured time zone. INTERVAL
 * currently has a fixed 12-hour cadence; its displayed time is informational.
 */
export const nextTaskRunAt = (scheduleType: TaskScheduleType, scheduleTime: string, now = new Date()): Date => {
  if (scheduleType === 'INTERVAL') return new Date(now.getTime() + 12 * 60 * 60 * 1000);

  const [hours, minutes] = validateScheduleTime(scheduleTime).split(':').map(Number);
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + (scheduleType === 'WEEKLY' ? 7 : 1));
  }
  return next;
};
