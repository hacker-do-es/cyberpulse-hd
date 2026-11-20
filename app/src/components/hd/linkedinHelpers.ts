import { useCallback, useEffect, useState } from 'react';
import { linkedinApi, type LinkedInStatus } from '@/services/hdApi';

const DRAFT_KEY = 'cyberpulse.linkedin.draft';
const AUTHOR_KEY = 'cyberpulse.linkedin.author';

export interface AuthorOption { value: string; label: string; page: boolean }

/* Pages first: posting as the company is the usual case. */
export function authorOptions(status: LinkedInStatus | null, memberLabel: string): AuthorOption[] {
  if (!status?.connected) return [];
  const opts: AuthorOption[] = status.canPostAsOrganization
    ? status.organizations.map((o) => ({ value: o.urn, label: o.name ?? o.urn.replace('urn:li:organization:', 'Page #'), page: true }))
    : [];
  if (status.canPostAsMember) opts.push({ value: 'member', label: memberLabel, page: false });
  return opts;
}

/* Last choice if still valid, else the first option (a Page when there is one). */
export function pickAuthor(opts: AuthorOption[]): string {
  let saved: string | null = null;
  try { saved = localStorage.getItem(AUTHOR_KEY); } catch { /* storage blocked */ }
  return opts.find((o) => o.value === saved)?.value ?? opts[0]?.value ?? '';
}

export function rememberAuthor(value: string): void {
  try { localStorage.setItem(AUTHOR_KEY, value); } catch { /* storage blocked */ }
}

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/* LinkedIn shows Markdown and list markers as literal characters, so publish
   plain text: no **bold** or # headings, and lines that start with "-", "*",
   "•", "→" or "1." get an emoji instead (a safety net for AI-written posts). */
export function toLinkedInText(content: string): string {
  return content
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split('\n')
    .map((line) => line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^\s*[-*•→▪·]\s+/, '▪️ ')
      .replace(/^\s*(\d)[.)]\s+/, (_m, d: string) => `${KEYCAPS[Number(d)]} `)
      .replace(/^-{3,}\s*$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stashDraft(text: string): void {
  try { sessionStorage.setItem(DRAFT_KEY, text); } catch { /* storage blocked */ }
}

export function takeDraft(): string | null {
  try {
    const t = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return t;
  } catch {
    return null;
  }
}

export function useLinkedInStatus() {
  const [status, setStatus] = useState<LinkedInStatus | null>(null);
  const reload = useCallback(async () => {
    try {
      setStatus(await linkedinApi.status());
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { status, reload };
}

