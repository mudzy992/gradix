import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, BriefcaseBusiness, CircleAlert, ClipboardList, Clock3, Moon, Sun, Wallet } from 'lucide-react'
import { BarChart, CountUp, ProgressBar, Skeleton, Sparkline } from './chart-primitives'
import { getActivity, getClosedTimers, getCreatedTasks, getDocumentAlerts, getPresence, getProjects, getSummary, getTaskAlerts, type DashboardProject, type Severity } from '@/lib/api-dashboard'
import { formatCompactMoney, formatDashboardDate, formatExactMoney, minutesParts, moneyProgress, toSafeNumber } from '@/lib/dashboard-format'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { Button } from '@/components/ui/button'

const ProjectMap = lazy(() => import('./project-map'))
const card = 'rounded-xl border border-border bg-card p-5 shadow-sm'
const heading = 'text-base font-semibold tracking-tight text-card-foreground'
const subheading = 'mt-1 text-sm text-muted-foreground'
const priority: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

function SectionState<T>({ query, allowed, fallback, children }: { query: UseQueryResult<T>; allowed: boolean; fallback?: ReactNode; children: (data: T) => ReactNode }) {
  const { t } = useTranslation()
  if (!allowed) return <p className="py-4 text-sm text-muted-foreground">{t('adminDashboard.forbidden')}</p>
  if (query.isPending) return fallback ?? <Skeleton label={t('adminDashboard.loading')} className="mt-4 h-24" />
  if (query.isError) return <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive"><span>{t('adminDashboard.loadError')}</span><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('adminDashboard.retry')}</Button></div>
  return <>{children(query.data)}</>
}
function Section({ title, description, children, className = '' }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section aria-label={title} className={`${card} ${className}`}><h2 className={heading}>{title}</h2>{description && <p className={subheading}>{description}</p>}{children}</section>
}
function readTheme() {
  try { return localStorage.getItem('gradix.dashboard.theme') === 'dark' } catch { return false }
}
function useDashboardTheme() {
  const [dark, setDark] = useState(readTheme)
  useEffect(() => {
    const root = document.documentElement
    const previous = root.classList.contains('dark')
    return () => { root.classList.toggle('dark', previous) }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('gradix.dashboard.theme', dark ? 'dark' : 'light') } catch { /* preference is optional */ }
  }, [dark])
  return { dark, setDark }
}

export function AdminDashboard() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberLocale = /^bs(?:-|$)/i.test(locale) ? 'de-DE' : locale
  const user = useAuthStore((state) => state.user)
  const selectedId = useCompanyStore((state) => state.selectedId)
  const revision = useCompanyStore((state) => state.revision)
  const platform = user?.roles?.includes('PLATFORM_ADMIN') ?? false
  const companyId = platform ? selectedId : user?.companyId
  const ready = Boolean(user?.id && companyId)
  const can = (...permissions: string[]) => permissions.every((permission) => user?.permissions?.includes(permission))
  const projectsAllowed = can('projects.read')
  const summaryAllowed = can('projects.read', 'tasks.read')
  const timersAllowed = can('payroll.read')
  const presenceAllowed = can('users.read', 'projects.read')
  const documentsAllowed = can('documents.read')
  const activityAllowed = can('users.read')
  const scope = ['dashboard-v2', user?.id, companyId, platform ? revision : 0]
  const summary = useQuery({ queryKey: [...scope, 'summary'], queryFn: async () => (await getSummary()).data, enabled: ready && summaryAllowed })
  const tasks = useQuery({ queryKey: [...scope, 'tasks'], queryFn: async () => (await getCreatedTasks({ limit: 7 })).data, enabled: ready && summaryAllowed })
  const timers = useQuery({ queryKey: [...scope, 'timers'], queryFn: async () => (await getClosedTimers({ limit: 7 })).data, enabled: ready && timersAllowed })
  const projects = useQuery({ queryKey: [...scope, 'projects'], queryFn: async () => (await getProjects({ limit: 10 })).data, enabled: ready && projectsAllowed })
  const presence = useQuery({ queryKey: [...scope, 'presence'], queryFn: async () => (await getPresence({ limit: 20 })).data, enabled: ready && presenceAllowed })
  const documents = useQuery({ queryKey: [...scope, 'document-alerts'], queryFn: async () => (await getDocumentAlerts({ limit: 20 })).data, enabled: ready && documentsAllowed })
  const taskAlerts = useQuery({ queryKey: [...scope, 'task-alerts'], queryFn: async () => (await getTaskAlerts({ limit: 20 })).data, enabled: ready && summaryAllowed })
  const activity = useQuery({ queryKey: [...scope, 'activity'], queryFn: async () => (await getActivity({ limit: 20 })).data, enabled: ready && activityAllowed })
  const { dark, setDark } = useDashboardTheme()
  const tz = tasks.data?.timezone ?? timers.data?.timezone
  const money = (value: string | null) => value === null ? t('adminDashboard.unknownBudget') : formatExactMoney(value, locale) ?? t('adminDashboard.unavailable')
  const statusLabels = { normal: t('adminDashboard.normal'), warning: t('adminDashboard.warning'), critical: t('adminDashboard.critical') }
  const located = (projects.data ?? []).filter((project): project is DashboardProject & { lat: string; lng: string } => {
    if (project.lat === null || project.lng === null) return false
    const lat = Number(project.lat), lng = Number(project.lng)
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  })
  const alertsPending = (documentsAllowed && documents.isPending) || (summaryAllowed && taskAlerts.isPending)
  const alertsFailed = (documentsAllowed && documents.isError) || (summaryAllowed && taskAlerts.isError)
  const alertsPartial = !documentsAllowed || !summaryAllowed
  const alerts = [
    ...(!documentsAllowed || documents.isError ? [] : documents.data ?? []).map((item) => ({ id: `d-${item.id}`, severity: item.severity, date: item.expiresAt, dateOnly: true, label: t(`adminDashboard.doc${item.kind === 'COMPANY' ? 'Company' : item.kind === 'WORKER' ? 'Worker' : 'Machine'}`), href: '/documents' })),
    ...(!summaryAllowed || taskAlerts.isError ? [] : taskAlerts.data ?? []).map((item) => ({ id: `t-${item.id}`, severity: item.severity, date: item.plannedEnd, dateOnly: false, label: t('adminDashboard.taskAlert', { title: item.title }), href: `/tasks/${item.id}` })),
  ].sort((a, b) => priority[a.severity] - priority[b.severity] || a.date.localeCompare(b.date))

  return <div className="mx-auto grid max-w-7xl gap-6 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold tracking-[0.16em] text-primary">{t('adminDashboard.eyebrow')}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{t('adminDashboard.title', { name: user?.firstName ?? '' })}</h1><p className="mt-1 text-sm text-muted-foreground">{t('adminDashboard.subtitle')}</p></div>
      <Button variant="outline" className="dark:hover:text-foreground" onClick={() => setDark(!dark)} aria-label={t(dark ? 'adminDashboard.light' : 'adminDashboard.dark')}>{dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{t(dark ? 'adminDashboard.light' : 'adminDashboard.dark')}</Button>
    </header>
    {!ready ? <div className={card}>{t('adminDashboard.selectCompany')}</div> : <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('adminDashboard.today')} description={t('adminDashboard.todayDescription')} className="flex flex-col">
          <dl className="mt-5 grid grid-cols-3 gap-3">
            <div><dt className="text-xs text-muted-foreground">{t('adminDashboard.todayPresence')}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{presenceAllowed && presence.isSuccess ? `${presence.data.length}${presence.data.length === 20 ? '+' : ''}` : '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('adminDashboard.openTimers')}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{summaryAllowed && summary.isSuccess ? summary.data.openTimers : '—'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t('adminDashboard.alerts')}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{!alertsPending && !alertsFailed && !alertsPartial ? `${alerts.length}${documents.data?.length === 20 || taskAlerts.data?.length === 20 ? '+' : ''}` : '—'}</dd></div>
          </dl>
          {(alertsFailed || alertsPartial) && <p className="mt-4 text-xs text-muted-foreground">{t('adminDashboard.partialAlerts')}</p>}
          <p className="mt-5 rounded-lg bg-muted/60 p-3 text-xs lg:mt-auto text-muted-foreground">{t('adminDashboard.presenceDescription')}</p>
        </Section>
        <Section title={t('adminDashboard.alerts')} description={t('adminDashboard.alertsDescription')}>
          {!documentsAllowed && !summaryAllowed ? <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.forbidden')}</p> : <>
            {alertsPending ? <Skeleton label={t('adminDashboard.loading')} className="mt-4 h-16" /> : null}
            {[documentsAllowed ? documents : null, summaryAllowed ? taskAlerts : null].map((query, index) => query?.isError ? <div role="alert" key={index} className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive"><span>{t('adminDashboard.partialAlerts')}</span><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t('adminDashboard.retry')}</Button></div> : null)}
            {alertsPartial && <p className="mt-3 text-sm text-muted-foreground">{t('adminDashboard.partialAlerts')}</p>}
            {alerts.length > 0 ? <ul className="mt-4 divide-y">{alerts.slice(0, 3).map((alert) => <li key={alert.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><CircleAlert className={`mt-0.5 size-4 shrink-0 ${alert.severity === 'CRITICAL' ? 'text-destructive' : alert.severity === 'HIGH' ? 'text-warning' : 'text-muted-foreground'}`} aria-hidden="true" /><div className="min-w-0 flex-1"><Link to={alert.href} className="font-medium text-primary underline-offset-4 hover:underline">{alert.label}</Link><p className="text-sm text-muted-foreground">{t('adminDashboard.due', { date: formatDashboardDate(alert.date, locale, alert.dateOnly ? 'UTC' : tz) })}</p></div><span className={`rounded-full px-2 py-1 text-xs font-medium ${alert.severity === 'CRITICAL' ? 'bg-destructive/10 text-destructive' : alert.severity === 'HIGH' ? 'bg-warning/10 text-warning' : 'bg-muted text-foreground'}`}>{t(`adminDashboard.${alert.severity}`)}</span></li>)}</ul> : !alertsPending && !alertsFailed && !alertsPartial && <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.noAlerts')}</p>}
            {alerts.length > 3 && <div className="mt-3 text-xs text-muted-foreground"><p>{t('adminDashboard.showingTopAlerts')}</p><div className="mt-2 flex flex-wrap gap-3">{summaryAllowed && <Link className="text-primary underline" to="/tasks">{t('adminDashboard.tasksLink')}</Link>}{documentsAllowed && <Link className="text-primary underline" to="/documents">{t('adminDashboard.documentsLink')}</Link>}</div></div>}
          </>}
        </Section>
      </div>
      <section key={`${user?.id}:${companyId}:${platform ? revision : 0}`} aria-label={t('adminDashboard.overview')}>
        <h2 className="sr-only">{t('adminDashboard.overview')}</h2>
        <SectionState query={summary} allowed={summaryAllowed} fallback={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} label={t('adminDashboard.loading')} className="h-[122px]" />)}</div>}>{(data) => <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: t('adminDashboard.activeProjects'), value: data.activeProjects, icon: BriefcaseBusiness },
              { label: t('adminDashboard.openTasks'), value: data.openTasks, icon: ClipboardList },
              { label: t('adminDashboard.openTimers'), value: data.openTimers, icon: Clock3 },
              { label: t('adminDashboard.spend'), value: `${formatCompactMoney(data.currentSpend, locale) ?? t('adminDashboard.unavailable')} ${data.currency ?? t('adminDashboard.currencyUnavailable')}`, title: `${money(data.currentSpend)} ${data.currency ?? t('adminDashboard.currencyUnavailable')}`, icon: Wallet },
            ].map(({ label, value, title, icon: Icon }) => <div key={label} data-kpi-card className={`${card} border-t-2 border-t-primary motion-safe:transition motion-safe:duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-md`}><div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{label}</span><span className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-4" aria-hidden="true" /></span></div><p title={title} aria-label={title} className="mt-4 text-2xl font-semibold tabular-nums">{typeof value === 'number' ? <CountUp value={value} locale={numberLocale} /> : value}</p></div>)}
          </div>
        </>}</SectionState>
      </section>
      <section aria-label={t('adminDashboard.actions')} className="flex flex-wrap items-center gap-2"><h2 className="mr-2 text-sm font-semibold">{t('adminDashboard.actions')}</h2>{[
        { can: projectsAllowed, to: '/projects', label: t('adminDashboard.projectsLink') }, { can: can('tasks.read'), to: '/tasks', label: t('adminDashboard.tasksLink') }, { can: can('users.write'), to: '/users', label: t('adminDashboard.teamLink') }, { can: documentsAllowed, to: '/documents', label: t('adminDashboard.documentsLink') },
      ].filter((item) => item.can).map((item) => <Button asChild variant="outline" size="sm" key={item.to}><Link to={item.to}>{item.label}<ArrowRight aria-hidden="true" /></Link></Button>)}</section>
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <Section title={t('adminDashboard.taskTrend')} description={t('adminDashboard.lastSeven')}><SectionState query={tasks} allowed={summaryAllowed}>{(data) => <div className="mt-4"><div className="text-2xl font-semibold tabular-nums">{new Intl.NumberFormat(numberLocale).format(data.current)}</div><p className={subheading}>{data.deltaPercent === null ? t('adminDashboard.noComparison') : t('adminDashboard.compare', { value: new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(data.deltaPercent) })}</p><div className="mt-3"><Sparkline label={t('adminDashboard.taskTrend')} values={data.series.map((row) => ({ label: formatDashboardDate(row.startAt, locale, data.timezone), value: row.count }))} emptyLabel={t('adminDashboard.noTrend')} tableLabel={t('adminDashboard.dataTable')} /></div></div>}</SectionState></Section>
        <Section title={t('adminDashboard.timerTrend')} description={t('adminDashboard.minutesTrend')}><SectionState query={timers} allowed={timersAllowed}>{(data) => { const parts = minutesParts(data.currentMinutes); return <div className="mt-4"><div className="text-2xl font-semibold tabular-nums">{parts ? t('adminDashboard.hours', { hours: new Intl.NumberFormat(numberLocale).format(parts.hours), minutes: parts.minutes }) : t('adminDashboard.unavailable')}</div><p className={subheading}>{data.deltaPercent === null ? t('adminDashboard.noComparison') : t('adminDashboard.compare', { value: formatExactMoney(data.deltaPercent, locale) ?? t('adminDashboard.unavailable') })}</p><div className="mt-3"><BarChart label={t('adminDashboard.minutesTrend')} values={data.series.map((row) => ({ label: formatDashboardDate(row.startAt, locale, data.timezone), value: toSafeNumber(row.minutes) }))} emptyLabel={t('adminDashboard.noTrend')} tableLabel={t('adminDashboard.dataTable')} /></div></div> }}</SectionState></Section>
      </div>
      {summaryAllowed && summary.isSuccess && summary.data.activeProjects === 0 && <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/5 p-5"><div><h2 className="font-semibold">{t('adminDashboard.emptyTitle')}</h2><p className={subheading}>{t('adminDashboard.emptyDescription')}</p></div>{can('projects.write') && <Button asChild><Link to="/projects">{t('adminDashboard.createProject')} <ArrowRight aria-hidden="true" /></Link></Button>}</div>}
      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <Section title={t('adminDashboard.projects')} description={t('adminDashboard.projectDescription')} className="xl:col-span-2"><SectionState query={projects} allowed={projectsAllowed}>{(rows) => rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.noProjects')}</p> : <div className="mt-4 divide-y">{rows.map((project) => <div key={project.id} className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1fr_1fr] sm:items-center"><div><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`/projects/${project.id}`}>{project.name}</Link><p className={subheading}>{project.plannedBudget === null ? t('adminDashboard.spendOnly', { spend: money(project.currentSpend) }) : t('adminDashboard.spendOf', { spend: money(project.currentSpend), budget: money(project.plannedBudget) })}</p></div><ProgressBar locale={numberLocale} label={t('adminDashboard.budgetProgress')} value={project.plannedBudget === null ? null : moneyProgress(project.currentSpend, project.plannedBudget)} max={100} unavailableLabel={t('adminDashboard.unavailable')} statusLabels={statusLabels} /></div>)}</div>}</SectionState></Section>
        <Section title={t('adminDashboard.presence')} description={t('adminDashboard.presenceDescription')}><SectionState query={presence} allowed={presenceAllowed}>{(rows) => rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.noPresence')}</p> : <ul className="mt-4 divide-y">{rows.map((person) => <li key={`${person.userId}-${person.projectId}`} className="py-3 first:pt-0 last:pb-0"><p className="font-medium">{person.firstName} {person.lastName}</p><p className="text-sm text-muted-foreground">{projects.data?.find((project) => project.id === person.projectId)?.name ?? t('adminDashboard.unknownProject')}</p><p className="text-xs text-muted-foreground">{t('adminDashboard.lastSeen', { date: formatDashboardDate(person.lastSeenAt, locale, tz, true) })}</p></li>)}</ul>}</SectionState></Section>
      </div>
      <div className="grid gap-4">
        <Section title={t('adminDashboard.map')} description={t('adminDashboard.mapDescription')}><SectionState query={projects} allowed={projectsAllowed}>{() => located.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.noLocations')}</p> : <div className="mt-4"><Suspense fallback={<Skeleton label={t('adminDashboard.mapLoading')} className="h-56" />}><ProjectMap projects={located} unavailableLabel={t('adminDashboard.mapUnavailable')} /></Suspense><p className="mt-2 text-xs text-muted-foreground">© <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</p><p className="mt-3 text-sm font-medium">{t('adminDashboard.mapList')}</p><ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">{located.map((project) => <li key={project.id}>{project.name}</li>)}</ul></div>}</SectionState></Section>

      </div>
      <Section title={t('adminDashboard.activity')} description={t('adminDashboard.activityDescription')}><SectionState query={activity} allowed={activityAllowed}>{(rows) => rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{t('adminDashboard.noActivity')}</p> : <ul className="mt-4 divide-y">{rows.map((event) => <li key={event.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><Activity className="size-4 text-primary" aria-hidden="true" /><span className="flex-1 text-sm">{t(`adminDashboard.events.${event.action}`, { defaultValue: t('adminDashboard.activityEvent') })}</span><time dateTime={event.createdAt} className="text-xs text-muted-foreground">{formatDashboardDate(event.createdAt, locale, tz, true)}</time></li>)}</ul>}</SectionState></Section>
    </>}
  </div>
}
