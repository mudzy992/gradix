import { useState } from 'react'
import { MenuIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { UserMenu } from '@/components/layout/user-menu'
import { Bell } from '@/components/notifications/bell'

function BrandNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-6">
      <p className="px-1 text-lg font-semibold tracking-tight text-primary">{t('app.name')}</p>
      <CompanySwitcher />
      <SidebarNav onNavigate={onNavigate} />
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-svh">
      <aside className="hidden w-64 shrink-0 border-r bg-card p-4 md:block">
        <BrandNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={t('nav.openMenu')}
            onClick={() => setOpen(true)}
          >
            <MenuIcon />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Bell />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-4">
          <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
          <BrandNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
