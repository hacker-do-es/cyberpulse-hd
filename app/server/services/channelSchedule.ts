import type { ChannelRow } from '../db/schema';
import { channelRepository } from '../repositories/channelRepository';
import { computeNextRun, parseWeekdays, toSqlUtc, type Schedule } from './schedule';

export function channelSchedule(c: Pick<ChannelRow, 'scheduleType' | 'intervalHours' | 'timeOfDay' | 'weekdays'>): Schedule {
  return {
    type: c.scheduleType,
    intervalHours: c.intervalHours,
    timeOfDay: c.timeOfDay,
    weekdays: parseWeekdays(c.weekdays),
  };
}

/* Recomputes next_run_at from the schedule and the company's time zone. */
export function rescheduleChannel(channelId: number, from = new Date()): void {
  const row = channelRepository.scheduleOf(channelId);
  if (!row) return;
  channelRepository.setNextRun(channelId, toSqlUtc(computeNextRun(channelSchedule(row), from, row.timezone)));
}

export function rescheduleTenant(tenantId: number): void {
  for (const id of channelRepository.idsByTenant(tenantId)) rescheduleChannel(id);
}
