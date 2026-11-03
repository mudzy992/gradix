import type { LucideIcon } from 'lucide-react'
import {
  Boxes,
  Building2,
  ChartColumn,
  Files,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Map,
  NotebookPen,
  Route,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
  Wrench,
  FileText,
} from 'lucide-react'
import { canSeePayroll } from '@/lib/payroll-access'
import type { MeUser } from '@/lib/api-types'

/**
 * FE-02 (D-041): jedna definicija navigacije.
 *
 * Zašto odvojeno od komponente: isti spisak koriste sidebar (render), `<AppShell>` (naslov
 * dokumenta) i guardovi za čitanje labela — tri mjesta koja bi se inače razišla. Grupisanje
 * zamjenjuje ravnu listu od 17 stavki: redoslijed prati posao (pregled → projekti → teren → ured
 * → administracija), a ne abecedu.
 */
export type NavItem = {
  to: string
  labelKey: string
  icon: LucideIcon
  /** Traži tačno ovaj permission. */
  permission?: string
  /** Traži bilo koji od ovih permita (npr. zadaci: `tasks.read` ili `tasks.dispatch`). */
  anyPermission?: string[]
  /** Plateau-only stavke se prikazuju samo kad je izabrana firma (tenant spreman). */
  tenant?: boolean
  /** Posebno pravilo vidljivosti (obračun ima svoju logiku uloga). */
  payroll?: boolean
}

export type NavSection = {
  id: string
  labelKey: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'overview',
    labelKey: 'nav.groups.overview',
    items: [{ to: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'work',
    labelKey: 'nav.groups.work',
    items: [
      { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, permission: 'projects.read', tenant: true },
      {
        to: '/tasks',
        labelKey: 'nav.tasks',
        icon: ListChecks,
        anyPermission: ['tasks.read', 'tasks.dispatch'],
        tenant: true,
      },
      { to: '/diary', labelKey: 'nav.diary', icon: NotebookPen, permission: 'diary.read', tenant: true },
    ],
  },
  {
    id: 'field',
    labelKey: 'nav.groups.field',
    items: [
      { to: '/fleet', labelKey: 'nav.fleet', icon: Truck, permission: 'fleet.read', tenant: true },
      { to: '/fleet/map', labelKey: 'nav.map', icon: Map, permission: 'fleet.map', tenant: true },
      { to: '/logistics', labelKey: 'nav.logistics', icon: Route, permission: 'trips.read', tenant: true },
      { to: '/hse', labelKey: 'nav.hse', icon: ShieldCheck, permission: 'hse.read', tenant: true },
    ],
  },
  {
    id: 'office',
    labelKey: 'nav.groups.office',
    items: [
      { to: '/tenders', labelKey: 'nav.tenders', icon: FileText, permission: 'tenders.read', tenant: true },
      { to: '/services', labelKey: 'nav.services', icon: Wrench, permission: 'services.read', tenant: true },
      { to: '/documents', labelKey: 'nav.documents', icon: Files, permission: 'documents.read', tenant: true },
      { to: '/reports', labelKey: 'nav.reports', icon: ChartColumn, permission: 'reports.read', tenant: true },
      { to: '/payroll', labelKey: 'nav.payroll', icon: Wallet, payroll: true, tenant: true },
      { to: '/erp', labelKey: 'nav.erp', icon: Boxes, permission: 'erp.read', tenant: true },
    ],
  },
  {
    id: 'admin',
    labelKey: 'nav.groups.admin',
    items: [
      { to: '/settings', labelKey: 'nav.settings', icon: Settings, permission: 'settings.write', tenant: true },
      { to: '/users', labelKey: 'nav.users', icon: Users, permission: 'users.write', tenant: true },
      { to: '/companies', labelKey: 'nav.companies', icon: Building2, permission: 'platform.companies' },
    ],
  },
]

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items)

/** Vidljivost jedne stavke — jedino mjesto gdje se pravilo primjenjuje (sidebar + testovi). */
export function isNavItemVisible(item: NavItem, user: MeUser | null): boolean {
  const permissions = user?.permissions ?? []
  if (item.payroll) {
    return canSeePayroll(user)
  }
  if (item.anyPermission?.length) {
    return item.anyPermission.some((permission) => permissions.includes(permission))
  }
  if (item.permission) {
    return permissions.includes(item.permission)
  }
  return true
}

/**
 * Aktivna stavka = **najduži** prefiks koji odgovara putanji. Tako `/fleet/map` gasi `/fleet`
 * (inače bi obje bile obojene), a `/projects/:id` i dalje drži `/projects` aktivnim.
 */
export function activeNavPath(pathname: string): string | null {
  let best: string | null = null
  for (const item of NAV_ITEMS) {
    const matches = pathname === item.to || pathname.startsWith(`${item.to}/`)
    if (matches && (best === null || item.to.length > best.length)) {
      best = item.to
    }
  }
  return best
}

/** Label ključ za naslov dokumenta (`<title>`); nepoznata ruta vraća `null`. */
export function navLabelKeyFor(pathname: string): string | null {
  const path = activeNavPath(pathname)
  return NAV_ITEMS.find((item) => item.to === path)?.labelKey ?? null
}
