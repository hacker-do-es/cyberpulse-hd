import { createContext, useContext } from 'react';
import { getLang, type Lang } from './core';

export interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const I18nContext = createContext<I18nValue>({ lang: getLang(), setLang: () => {} });

/* Subscribes a component to language changes. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
