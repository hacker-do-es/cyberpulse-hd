import { ES, ES_PATTERNS } from './es';

/* Interface language (English / Spanish).

   The English text stays in the code and is the lookup key: tr('Save')
   returns 'Guardar' in Spanish and 'Save' in English, and anything without a
   translation simply shows in English. {name} placeholders are filled from
   `vars`. tr() reads the current language from this module, so it also works
   in helpers outside components; the app shell subscribes to the language
   (useI18n in Layout/LoginPage), so every screen re-renders when it changes.

   Only the interface is translated. Digests keep each company's language. */

export type Lang = 'en' | 'es';
const STORAGE_KEY = 'cyberpulse.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* storage blocked */ }
  return typeof navigator !== 'undefined' && /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
}

let current: Lang = initialLang();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

/* Locale for dates and numbers. */
export function locale(): string {
  return current === 'es' ? 'es-ES' : 'en-US';
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function tr(en: string, vars?: Record<string, string | number>): string {
  if (current === 'es') {
    const hit = ES[en];
    if (hit !== undefined) return fill(hit, vars);
  }
  return fill(en, vars);
}

/* Messages that arrive as text (server errors): exact match first, then
   patterns for the ones that carry numbers or names. */
export function trMessage(message: string): string {
  if (current !== 'es') return message;
  const hit = ES[message];
  if (hit !== undefined) return hit;
  for (const [re, es] of ES_PATTERNS) {
    if (re.test(message)) return message.replace(re, es);
  }
  return message;
}

/* Used by the provider when the user picks a language. */
export function applyLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch { /* storage blocked: still switches for this visit */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
