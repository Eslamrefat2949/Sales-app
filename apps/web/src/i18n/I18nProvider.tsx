import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readJson, writeJson } from '../lib/storage.ts';
import { MESSAGES, type Lang, type Messages } from './messages.ts';

interface I18nValue {
  readonly lang: Lang;
  readonly t: Messages;
  readonly toggleLanguage: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (readJson<Lang>('lang', 'ar') === 'en' ? 'en' : 'ar'));

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    writeJson('lang', lang);
  }, [lang]);

  const toggleLanguage = useCallback(() => setLang((current) => (current === 'ar' ? 'en' : 'ar')), []);
  const value = useMemo(() => ({ lang, t: MESSAGES[lang], toggleLanguage }), [lang, toggleLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
