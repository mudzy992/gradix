import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { bs } from '@/i18n/bs';
import { en } from '@/i18n/en';

void i18n.use(initReactI18next).init({
  lng: 'bs',
  fallbackLng: 'bs',
  resources: { bs: { translation: bs }, en: { translation: en } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export { i18n };
