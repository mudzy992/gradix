import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { cn } from '@/lib/utils'
import {
  activeNavPath,
  isNavItemVisible,
  NAV_SECTIONS,
  type NavItem,
} from '@/components/layout/navigation'

type SidebarNavProps = {
  onNavigate?: () => void
}

/**
 * FE-02 (D-041): navigacija je grupisanana (Pregled / Posao / Teren / Ured / Administracija) i
 * svaka stavka ima ikonu + tekst. Ikona nikad nije jedini nosilac značenja (a11y), a aktivna
 * stavka je **najduži** prefiks putanje — vidi `activeNavPath`.
 */
export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const user = useAuthStore((state) => state.user)
  const { pathname } = useLocation()
  const active = activeNavPath(pathname)

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const disabled = Boolean(item.tenant && !tenantReady)
    const isActive = active === item.to
    return (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={disabled ? (event) => event.preventDefault() : onNavigate}
        aria-disabled={disabled}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          disabled && 'pointer-events-none opacity-40',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground hover:bg-secondary hover:text-secondary-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t(item.labelKey)}</span>
      </NavLink>
    )
  }

  return (
    <nav className="grid gap-5" aria-label={t('nav.menu')}>
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => isNavItemVisible(item, user))
        if (!items.length) {
          return null
        }
        const headingId = `nav-${section.id}`
        return (
          <div key={section.id} className="grid gap-1">
            <p
              id={headingId}
              className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t(section.labelKey)}
            </p>
            <div className="grid gap-0.5" role="group" aria-labelledby={headingId}>
              {items.map(renderItem)}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
