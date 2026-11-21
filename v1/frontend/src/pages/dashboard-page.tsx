import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Bell,
  ChartColumn,
  FolderKanban,
  ListChecks,
  Route,
  Timer,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { getDashboard } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { displayName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { NAV_ITEMS, isNavItemVisible } from '@/components/layout/navigation'
import { cn } from '@/lib/utils'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'

/**
 * FE-04 (D-043) — dashboard je odgovor na tri pitanja, po roli: šta ističe, ko je na terenu,
 * koliko trošimo. Kartice dolaze sa backenda (`dashboard-role.ts`), a ovdje dobijaju ikonu,
 * ciljnu stranicu i prevod; sve ostalo je jedan klik dalje.
 */

/** Ključevi koje backend vraća (`dashboard*.ts`) → ikona i ciljna ruta. */
const CARD_META: Record<string, { icon: LucideIcon; to?: string }> = {
  activeProjects: { icon: FolderKanban, to: '/projects' },
  scopedProjects: { icon: FolderKanban, to: '/projects' },
  spend: { icon: Wallet, to: '/reports' },
  openTimers: { icon: Timer, to: '/payroll' },
  unread: { icon: Bell },
  presence: { icon: Users, to: '/projects' },
  myTasks: { icon: ListChecks, to: '/tasks' },
  myTimer: { icon: Timer },
  progress: { icon: ChartColumn, to: '/projects' },
  machines: { icon: Truck, to: '/fleet' },
  tripsToday: { icon: Route, to: '/logistics' },
}

/** Prečice: redoslijed prati posao (projekti → zadaci → dnevnik → teren). */
const QUICK_ACTION_PATHS = ['/projects', '/tasks', '/diary', '/fleet', '/hse', '/documents']

const MAX_EXPIRING = 6

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.roles?.some((role) => ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN'].includes(role)) ?? false
  return isAdmin ? <AdminDashboard /> : <LegacyDashboardPage />
}

export function LegacyDashboardPage() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const tenantReady = useTenantReady()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await getDashboard()).data,
    enabled: tenantReady,
  })

  const cards = query.data?.cards ?? []
  const presence = query.data?.presence ?? null
  const expiring = [...(query.data?.expiring ?? [])].sort((a, b) => a.daysLeft - b.daysLeft)

  const quickActions = NAV_ITEMS.filter(
    (item) =>
      QUICK_ACTION_PATHS.includes(item.to) && isNavItemVisible(item, user) && (!item.tenant || tenantReady),
  ).slice(0, 4)

  const today = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const urgency = (daysLeft: number) => {
    if (daysLeft < 0) return { badge: 'destructive' as const, text: 'text-destructive' }
    if (daysLeft <= 5) return { badge: 'destructive' as const, text: 'text-destructive' }
    if (daysLeft <= 15) return { badge: 'secondary' as const, text: 'text-warning' }
    return { badge: 'outline' as const, text: 'text-muted-foreground' }
  }

  return (
    <div className="grid gap-6">
      {/* A — zaglavlje */}
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('dashboard.welcome', { name: user ? displayName(user) : '' })} ·{' '}
          <span className="capitalize">{today}</span>
        </p>
      </header>

      {/* B — brze akcije (ista vidljivost kao sidebar) */}
      {quickActions.length > 0 ? (
        <section aria-labelledby="dashboard-quick" className="grid gap-2">
          <h2 id="dashboard-quick" className="text-sm font-medium text-muted-foreground">
            {t('dashboard.quickActions')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {quickActions.map((item) => {
              const Icon = item.icon
              return (
                <Button key={item.to} asChild variant="secondary" size="sm">
                  <Link to={item.to}>
                    <Icon aria-hidden="true" />
                    {t(item.labelKey)}
                  </Link>
                </Button>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* C — KPI traka */}
      <section aria-labelledby="dashboard-kpi" aria-busy={query.isLoading} className="grid gap-2">
        <h2 id="dashboard-kpi" className="sr-only">
          {t('dashboard.kpi')}
        </h2>
        {query.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                </CardHeader>
                <CardContent>
                  <div className="h-7 w-16 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          cards.length === 0 ? (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                {tenantReady ? t('dashboard.noCards') : t('dashboard.selectCompany')}
              </CardContent>
            </Card>
          ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => {
              const meta = CARD_META[card.key] ?? { icon: ChartColumn as LucideIcon }
              const Icon = meta.icon
              const body = (
                <>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t(`dash.${card.key}`, { defaultValue: card.key })}
                    </CardTitle>
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold tabular-nums">{dash(card.value)}</p>
                  </CardContent>
                </>
              )
              return meta.to ? (
                <Card key={card.key} className="transition-colors hover:border-primary/40">
                  <Link to={meta.to} className="block rounded-xl">
                    {body}
                  </Link>
                </Card>
              ) : (
                <Card key={card.key}>{body}</Card>
              )
            })}
          </div>
          )
        )}
        {query.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{t('dashboard.loadError')}</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t('dashboard.retry')}
            </Button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {/* D — rokovi i dokumenti */}
        <section aria-labelledby="dashboard-expiring" className="grid gap-2">
          <Card>
            <CardHeader>
              <h2 id="dashboard-expiring" className="text-base font-semibold leading-none">
                {t('dashboard.expiring')}
              </h2>
              <p className="text-xs text-muted-foreground">{t('dashboard.expiringHint')}</p>
            </CardHeader>
            <CardContent>
              {expiring.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dashboard.allClear')}</p>
              ) : (
                <ul className="grid gap-2">
                  {expiring.slice(0, MAX_EXPIRING).map((item) => {
                    const level = urgency(item.daysLeft)
                    return (
                      <li
                        key={`${item.entityType}-${item.entityId}-${item.type}`}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium capitalize">{item.type}</p>
                          <p className="text-xs text-muted-foreground">
                            {t(`dashboard.entity.${item.entityType}`, {
                              defaultValue: item.entityType,
                            })}
                          </p>
                        </div>
                        <Badge variant={level.badge} className={cn(level.text)}>
                          {item.daysLeft < 0
                            ? t('dashboard.expired', { count: Math.abs(item.daysLeft) })
                            : item.daysLeft === 0
                              ? t('dashboard.today')
                              : t('dashboard.daysLeft', { count: item.daysLeft })}
                        </Badge>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        {/* E — prisustvo */}
        <section aria-labelledby="dashboard-presence" className="grid gap-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <h2 id="dashboard-presence" className="text-base font-semibold leading-none">
                {t('dashboard.onSite')}
              </h2>
              {presence ? <Badge variant="secondary">{presence.length}</Badge> : null}
            </CardHeader>
            <CardContent>
              {!presence ? (
                <p className="text-sm text-muted-foreground">{t('dashboard.presenceUnavailable')}</p>
              ) : presence.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('dashboard.nobodyOnSite')}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {presence.map((person) => (
                    <li
                      key={`${person.userId}-${person.projectId}`}
                      className="flex items-center gap-2 rounded-full border border-border py-1 pl-1 pr-3"
                    >
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[10px]">
                          {initials(person.firstName, person.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">
                        {person.firstName} {person.lastName}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
