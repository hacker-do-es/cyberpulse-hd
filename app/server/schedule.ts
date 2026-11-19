/* Channel schedules, computed in each company's own time zone (DST-aware,
   no dependencies beyond Intl).

   - interval: every N hours (1..168)
   - weekly:   on the chosen weekdays (0 = Sunday .. 6 = Saturday) at HH:MM.
               "Daily" is simply all seven days.                            */

export interface Schedule {
  type: 'interval' | 'weekly';
  intervalHours?: number | null;
  timeOfDay?: string | null;
  weekdays?: number[] | null;
}

export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateSchedule(s: Schedule): string | null {
  if (s.type === 'interval') {
    const h = Number(s.intervalHours);
    if (!Number.isInteger(h) || h < 1 || h > 168) return 'Interval must be a whole number of hours between 1 and 168';
    return null;
  }
  if (s.type === 'weekly') {
    if (!s.timeOfDay || !TIME_RE.test(s.timeOfDay)) return 'Time must be HH:MM (24h)';
    if (!Array.isArray(s.weekdays) || s.weekdays.length === 0) return 'Pick at least one weekday';
    if (s.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Weekdays must be 0-6';
    return null;
  }
  return 'Unknown schedule type';
}

/* Offset (ms) of `tz` from UTC at instant `date`: local wall clock minus UTC. */
export function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/* The UTC instant at which the wall clock in `tz` reads the given time. In the
   spring-forward gap the result lands just after the gap; in the autumn
   overlap it picks the first occurrence. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(ts), tz);
  ts = guess - off2;
  return new Date(ts);
}

function localDate(date: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function computeNextRun(s: Schedule, from: Date, tz: string): Date {
  if (s.type === 'interval') {
    return new Date(from.getTime() + Number(s.intervalHours) * 3600_000);
  }

  const [hh, mm] = (s.timeOfDay as string).split(':').map(Number);
  const days = new Set(s.weekdays ?? []);
  const today = localDate(from, tz);

  for (let offset = 0; offset <= 8; offset++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
    if (!days.has(day.getUTCDay())) continue;
    const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz);
    if (candidate.getTime() > from.getTime()) return candidate;
  }
  /* Unreachable with a valid schedule; fall back to a day later. */
  return new Date(from.getTime() + 24 * 3600_000);
}

/* SQLite CURRENT_TIMESTAMP format (UTC), so stored values compare as text. */
export function toSqlUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

export function fromSqlUtc(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z');
}

export function parseWeekdays(value: string | null | undefined): number[] {
  if (!value) return [];
  return value.split(',').map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}
