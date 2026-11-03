import { useEffect, useRef, useState } from 'react'
import { MenuIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { UserMenu } from '@/components/layout/user-menu'
import { navLabelKeyFor } from '@/components/layout/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { Bell } from '@/components/notifications/bell'

function Brand() {
  const { t } = useTranslation()
  return <p className="px-1 text-lg font-semibold tracking-tight text-primary">{t('app.name')}</p>
}

function BrandNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="grid gap-6">
      <Brand />
      <CompanySwitcher />
      <SidebarNav onNavigate={onNavigate} />
    </div>
  )
}

/**
 * FE-02 (D-041): shell nosi četiri stvari koje su prije nedostajale:
 *  1. „preskoči na sadržaj“ link (prvi tabulator stanice uvijek vodi u sadržaj),
 *  2. `<main id="main">` sa fokusom — ekran čitač objavi novi ekran poslije navigacije,
 *  3. naslov dokumenta po ruti (`<title>` se mijenja, inače svi tabovi pišu „Gradix“),
 *  4. reset skrola pri promjeni rute (bez toga nova stranica starta na staroj poziciji).
 */
export function AppShell() {
  const { t, i18n } = useTranslation()
  const locale = useAuthStore((state) => state.user?.locale)
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const mainRef = useRef<HTMLElement | null>(null)
  const firstRender = useRef(true)
  const labelKey = navLabelKeyFor(pathname)

  // Jezik korisnika iz profila (`/me.locale`) inače ostaje neprimijenjen do ručnog prebacivanja —
  // bootstrap učitava korisnika, a i18n je startovao na `bs`.
  useEffect(() => {
    if (locale && locale !== i18n.language) {
      void i18n.changeLanguage(locale)
    }
  }, [locale, i18n])

  // `<html lang>` mora pratiti jezik — čitači ekrana i prijevod u browseru se na to oslanjaju.
  useEffect(() => {
    document.documentElement.lang = i18n.language?.startsWith('en') ? 'en' : 'bs'
  }, [i18n.language])

  useEffect(() => {
    document.title = labelKey ? `${t(labelKey)} · ${t('app.name')}` : t('app.name')
  }, [labelKey, t])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    // Fokus ide na sadržaj, ne na vrh stranice — tastatura i čitač ekrana nastavljaju odavde.
    mainRef.current?.focus()
  }, [pathname])

  return (
    <div className="flex min-h-svh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t('nav.skipToContent')}
      </a>
      <aside className="hidden w-64 shrink-0 border-r bg-card md:block">
        <div className="sticky top-0 h-svh overflow-y-auto p-4">
          <BrandNav />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('nav.openMenu')}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <MenuIcon aria-hidden="true" />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Bell />
            <UserMenu />
          </div>
        </header>
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 p-4 focus:outline-none md:p-6"
        >
          <Outlet />
        </main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 overflow-y-auto p-4">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <BrandNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
