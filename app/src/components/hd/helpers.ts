import { toast } from 'sonner';

/* Non-component helpers shared by the Hacker-Do management screens. */

export const inputCls = 'bg-bg-input border-border-default text-text-primary placeholder:text-text-tertiary';
export const selectCls =
  'h-9 w-full rounded-md border border-border-default bg-bg-input px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40';

export function notifyError(err: unknown, fallback = 'Something went wrong') {
  toast.error(err instanceof Error ? err.message : fallback);
}

export function formatDateTime(value: string | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

export const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

export const TIMEZONES = [
  'Europe/Madrid', 'Atlantic/Canary', 'Europe/Lisbon', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Bogota', 'America/Santiago',
  'America/Lima', 'America/Montevideo', 'America/Sao_Paulo', 'America/New_York', 'America/Los_Angeles', 'UTC',
];
