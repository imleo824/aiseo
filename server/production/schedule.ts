type CalendarSchedule = { minutes?: number; time?: string; timezone?: string };

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number };

const partsAt = (instant: Date, timezone: string): CalendarParts => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
  } catch {
    throw new Error('自动任务时区无效');
  }
  const values = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
};

const localCalendarToInstant = (parts: CalendarParts, timezone: string): Date => {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = partsAt(new Date(candidate), timezone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const correction = target - observedAsUtc;
    if (correction === 0) return new Date(candidate);
    candidate += correction;
  }
  // A local time can be skipped at the DST spring transition. In that case,
  // choose the first valid local minute after the requested wall-clock time.
  for (let offset = 0; offset <= 180; offset += 1) {
    const instant = new Date(candidate + offset * 60_000);
    const observed = partsAt(instant, timezone);
    const sameDate = observed.year === parts.year && observed.month === parts.month && observed.day === parts.day;
    if (sameDate && (observed.hour * 60 + observed.minute) >= (parts.hour * 60 + parts.minute)) return instant;
  }
  throw new Error('无法解析自动任务的下一次当地执行时间');
};

export const isValidTimezone = (timezone: string): boolean => {
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); return true; } catch { return false; }
};

export const nextAutomationRun = (current: Date, scheduleType: string, config: CalendarSchedule, now = new Date()): Date => {
  if (scheduleType === 'INTERVAL') {
    const minutes = Number(config.minutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 43_200) throw new Error('自动任务间隔必须为 15 到 43200 分钟');
    return new Date(Math.max(now.getTime(), current.getTime()) + minutes * 60_000);
  }
  if (scheduleType !== 'DAILY' && scheduleType !== 'WEEKLY') throw new Error('自动任务调度类型无效');
  if (!config.time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time) || !config.timezone || !isValidTimezone(config.timezone)) {
    throw new Error('自动任务缺少有效的当地时间或 IANA 时区');
  }
  const [hour, minute] = config.time.split(':').map(Number);
  const stepDays = scheduleType === 'WEEKLY' ? 7 : 1;
  const baseline = partsAt(current, config.timezone);
  for (let offsetDays = stepDays; offsetDays <= stepDays * 370; offsetDays += stepDays) {
    const calendar = new Date(Date.UTC(baseline.year, baseline.month - 1, baseline.day + offsetDays));
    const candidate = localCalendarToInstant({
      year: calendar.getUTCFullYear(),
      month: calendar.getUTCMonth() + 1,
      day: calendar.getUTCDate(),
      hour,
      minute
    }, config.timezone);
    if (candidate > now && candidate > current) return candidate;
  }
  throw new Error('无法计算自动任务的下一次执行时间');
};
