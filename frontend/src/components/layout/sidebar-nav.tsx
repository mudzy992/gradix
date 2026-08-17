import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { canSeePayroll } from '@/lib/payroll-access'
import { cn } from '@/lib/utils'

type NavItem = {
  to: string
  labelKey: string
  permission?: string
  tenant?: boolean
}

const ITEMS: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard' },
  { to: '/projects', labelKey: 'nav.projects', permission: 'projects.read', tenant: true },
  { to: '/tasks', labelKey: 'nav.tasks', permission: 'tasks.read', tenant: true },
  { to: '/fleet', labelKey: 'nav.fleet', permission: 'fleet.read', tenant: true },
  { to: '/fleet/map', labelKey: 'nav.map', permission: 'fleet.map', tenant: true },
  { to: '/logistics', labelKey: 'nav.logistics', permission: 'trips.read', tenant: true },
  { to: '/diary', labelKey: 'nav.diary', permission: 'diary.read', tenant: true },
  { to: '/hse', labelKey: 'nav.hse', permission: 'hse.read', tenant: true },
  { to: '/tenders', labelKey: 'nav.tenders', permission: 'tenders.read', tenant: true },
  { to: '/services', labelKey: 'nav.services', permission: 'services.read', tenant: true },
  { to: '/documents', labelKey: 'nav.documents', permission: 'documents.read', tenant: true },
  { to: '/reports', labelKey: 'nav.reports', permission: 'reports.read', tenant: true },
  { to: '/payroll', labelKey: 'nav.payroll', permission: 'payroll.read', tenant: true },
  { to: '/erp', labelKey: 'nav.erp', permission: 'erp.read', tenant: true },
  { to: '/settings', labelKey: 'nav.settings', permission: 'settings.write', tenant: true },
  { to: '/users', labelKey: 'nav.users', permission: 'users.write', tenant: true },
  { to: '/companies', labelKey: 'nav.companies', permission: 'platform.companies' },
]

type SidebarNavProps = {
  onNavigate?: () => void
}

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const user = useAuthStore((state) => state.user)
  const permissions = user?.permissions ?? []
  const visible = ITEMS.filter((item) => {
    if (!item.permission) {
      return true
    }
    if (item.to === '/tasks') {
      return permissions.includes('tasks.read') || permissions.includes('tasks.dispatch')
    }
    if (item.to === '/payroll') {
      return canSeePayroll(user)
    }
    return permissions.includes(item.permission)
  })
  return (
    <nav className="grid gap-1" aria-label={t('nav.menu')}>
      {visible.map((item) => {
        const disabled = Boolean(item.tenant && !tenantReady)
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={disabled ? (event) => event.preventDefault() : onNavigate}
            aria-disabled={disabled}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                disabled && 'pointer-events-none opacity-40',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-secondary',
              )
            }
          >
            {t(item.labelKey)}
          </NavLink>
        )
      })}
    </nav>
  )
}
