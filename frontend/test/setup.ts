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

/**
 * FE-10: Radix `Select` (i druge portalu komponente) traže `hasPointerCapture`/`releasePointerCapture`
 * i `scrollIntoView`, koje jsdom ne implementira — bez ovoga se meni ne može ni otvoriti u testu.
 * Stubovi su samo za jsdom; u browseru ih obezbjeđuje sam browser.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = (() => false) as typeof Element.prototype.hasPointerCapture
  Element.prototype.releasePointerCapture = (() => {}) as typeof Element.prototype.releasePointerCapture
  Element.prototype.setPointerCapture = (() => {}) as typeof Element.prototype.setPointerCapture
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (() => {}) as typeof Element.prototype.scrollIntoView
}
