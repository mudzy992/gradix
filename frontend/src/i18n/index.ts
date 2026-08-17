import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { bs } from './bs'
import { en } from './en'
import { opsBs } from './ops-bs'
import { opsEn } from './ops-en'
import { polishBs } from './polish-bs'
import { polishEn } from './polish-en'
import { publicBs } from './public-bs'
import { publicEn } from './public-en'
import { payrollBs } from './payroll-bs'
import { payrollEn } from './payroll-en'
import { erpBs } from './erp-bs'
import { erpEn } from './erp-en'

void i18n.use(initReactI18next).init({
  resources: {
    bs: { translation: { ...bs, ...opsBs, ...polishBs, ...publicBs, ...payrollBs, ...erpBs } },
    en: { translation: { ...en, ...opsEn, ...polishEn, ...publicEn, ...payrollEn, ...erpEn } },
  },
  lng: 'bs',
  fallbackLng: 'bs',
  interpolation: { escapeValue: false },
})

export { i18n }
