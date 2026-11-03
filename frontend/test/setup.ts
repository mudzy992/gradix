import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import '@/i18n'
import i18n from 'i18next'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'

/**
 * Zajednička priprema za sve frontend testove:
 * 1. i18n sa **stvarnim** bs/en resursima (test tako hvata i nedostajući ključ — vidi FE-04),
 * 2. čist DOM i čist auth/tenant store između testova (nema curenja stanja),
 * 3. `matchMedia`/`ResizeObserver` stubovi — jsdom ih ne implementira, a Radix komponente ih traže.
 */
beforeEach(() => {
  void i18n.changeLanguage('bs')
  useAuthStore.setState({ accessToken: null, user: null, ready: true })
  useCompanyStore.setState({ selectedId: null })
})

afterEach(() => {
  cleanup()
})

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
