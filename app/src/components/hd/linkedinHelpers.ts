import { useCallback, useEffect, useState } from 'react';
import { linkedinApi, type LinkedInStatus } from '@/services/hdApi';

const DRAFT_KEY = 'cyberpulse.linkedin.draft';

/* The generator uses **bold**; LinkedIn has no bold, so publish plain text. */
export function toLinkedInText(content: string): string {
  return content.replace(/\*\*(.+?)\*\*/g, '$1').trim();
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

