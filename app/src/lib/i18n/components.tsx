import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { applyLang, getLang, type Lang } from './core';
import { I18nContext, useI18n } from './context';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getLang());
  const setLang = useCallback((l: Lang) => {
    applyLang(l);
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/* Flag button like hacker-do.es: shows the flag of the language you switch TO. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const next: Lang = lang === 'es' ? 'en' : 'es';
  const label = lang === 'es' ? 'Switch to English' : 'Cambiar a español';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={label}
      aria-label={label}
      className={`h-8 px-2 inline-flex items-center justify-center rounded-md border border-border-default hover:border-accent transition-colors cursor-pointer ${className}`}
    >
      {next === 'en' ? (
        <svg width="22" height="15" viewBox="0 0 22 15" aria-hidden="true">
          <rect width="22" height="15" fill="#fff" />
          {[0, 2, 4, 6, 8, 10, 12].map((y) => <rect key={y} y={y} width="22" height="1.15" fill="#B22234" />)}
          <rect width="9" height="8.08" fill="#3C3B6E" />
        </svg>
      ) : (
        <svg width="22" height="15" viewBox="0 0 22 15" aria-hidden="true">
          <rect width="22" height="15" fill="#AA151B" />
          <rect y="3.75" width="22" height="7.5" fill="#F1BF00" />
        </svg>
      )}
    </button>
  );
}
