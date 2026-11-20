import { locale, tr, trMessage } from '@/lib/i18n';

export function timeAgo(dateStr: string | Date | null | undefined): string {
  const date = new Date(dateStr ?? '');
  /* Already a display string (older API field): translate it as text. */
  if (isNaN(date.getTime())) return trMessage(String(dateStr ?? '').toUpperCase()) || tr('UNKNOWN');

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return tr('JUST NOW');
  if (diffMin < 60) return tr('{n} MIN AGO', { n: diffMin });
  if (diffHrs < 24) return diffHrs > 1 ? tr('{n} HRS AGO', { n: diffHrs }) : tr('1 HR AGO');
  if (diffDays < 7) return diffDays > 1 ? tr('{n} DAYS AGO', { n: diffDays }) : tr('1 DAY AGO');
  return date.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }).toUpperCase();
}

export function publishDate(dateStr: string | Date | null | undefined): string {
  const date = new Date(dateStr ?? '');
  if (isNaN(date.getTime())) return String(dateStr ?? '') || tr('UNKNOWN');
  return date.toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' });
}
