import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';

type LanguagePreferences = {
  languageOne: string;
  languageTwo: string;
  setLanguageOne: (language: string) => void;
  setLanguageTwo: (language: string) => void;
};

const LanguagePreferencesContext = createContext<LanguagePreferences | null>(null);

export function LanguagePreferencesProvider({ children }: PropsWithChildren) {
  const [languageOne, setLanguageOne] = useState('English');
  const [languageTwo, setLanguageTwo] = useState('Spanish');
  const value = useMemo(() => ({ languageOne, languageTwo, setLanguageOne, setLanguageTwo }), [languageOne, languageTwo]);
  return <LanguagePreferencesContext.Provider value={value}>{children}</LanguagePreferencesContext.Provider>;
}

export function useLanguagePreferences() {
  const value = useContext(LanguagePreferencesContext);
  if (!value) throw new Error('useLanguagePreferences must be used inside LanguagePreferencesProvider.');
  return value;
}
