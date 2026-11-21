import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listDiary, listProjects } from '@/lib/api-ops'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useDisplayPrefs } from '@/hooks/use-public-settings'
import { formatDateTime } from '@/lib/format-date'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProjectDiaryTab } from '@/components/ops/project-diary-tab'

/**
 * FE-10 — mjesečni dnevnik. Nalazi: polje mjeseca nije imalo labelu, izbor projekta nije imao ni
 * labelu ni opciju „Svi projekti“ (filter se nije mogao poništiti), dani su bili **dugmad koja ništa
 * ne rade** i zvala su se samo „01“, „02“… (čitač ekrana nije znao ni mjesec ni da li dan ima unos),
 * kalendar nije počinjao na pravom danu sedmice, a nije bilo stanja učitavanja/greške/praznog mjeseca.
 */
export function DiaryPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const prefs = useDisplayPrefs()
  const [params, setParams] = useSearchParams()
  const [chosenMonth, setMonth] = useState<string | null>(null)
  const month = chosenMonth ?? formatDateTime(new Date().toISOString(), prefs.timeZone, 'yyyy-MM-dd').slice(0, 7)
  const projectId = params.get('projectId') ?? ''
  const projects = useQuery({
    queryKey: ['projects', { limit: 100 }],
    queryFn: async () => (await listProjects({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const from = `${month}-01`
  const to = useMemo(() => {
    const [year, mon] = month.split('-').map(Number)
    const last = new Date(Date.UTC(year, mon, 0)).getUTCDate()
    return `${month}-${String(last).padStart(2, '0')}`
  }, [month])
  const entries = useQuery({
    queryKey: ['diary', { projectId, from, to }],
    queryFn: async () => (await listDiary({ projectId: projectId || undefined, from, to, limit: 100 })).data,
    enabled: tenantReady,
  })
  const rows = entries.data ?? []
  const byDate = new Map(rows.map((row) => [row.date, row]))
  const days = useMemo(() => {
    const [year, mon] = month.split('-').map(Number)
    const last = new Date(Date.UTC(year, mon, 0)).getUTCDate()
    // Prazne ćelije do prvog dana mjeseca — kalendar mora počinjati na pravom danu sedmice.
    const offset = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7
    return [
      ...Array.from({ length: offset }, (_, index) => `blank-${index}`),
      ...Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
    ]
  }, [month])
  const weekdays = ['pon', 'uto', 'sri', 'čet', 'pet', 'sub', 'ned']
  const projectName = projects.data?.find((row) => row.id === projectId)?.name
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('diary.title')}</h1>
      <p className="text-xs text-muted-foreground">{prefs.timeZone}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          {/* FE-10: polje mjeseca je imalo samo vizuelni kontekst. */}
          <label className="text-xs text-muted-foreground" htmlFor="diary-month">
            {t('diary.month')}
          </label>
          <input
            id="diary-month"
            type="month"
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t('projects.title')}</span>
          <Select
            value={projectId || 'all'}
            onValueChange={(value) => setParams(value === 'all' ? {} : { projectId: value })}
          >
            <SelectTrigger className="w-56" aria-label={t('projects.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* FE-10: bez ove opcije filter se nije mogao poništiti. */}
              <SelectItem value="all">{t('diary.allProjects')}</SelectItem>
              {(projects.data ?? []).map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div aria-busy={entries.isLoading} className="grid gap-2">
        <p className="text-sm text-muted-foreground">
          {entries.isSuccess
            ? rows.length > 0
              ? t('diary.count', { count: rows.length })
              : t('diary.empty')
            : null}
        </p>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {weekdays.map((day) => (
            <div key={day} className="px-2 text-center text-muted-foreground">
              {day}
            </div>
          ))}
          {days.map((day) => {
            if (day.startsWith('blank-')) {
              return <div key={day} aria-hidden="true" />
            }
            const entry = byDate.get(day)
            const label = entry
              ? t('diary.dayWithEntry', { date: day })
              : t('diary.dayEmpty', { date: day })
            return (
              <div
                key={day}
                // FE-10: dan je bio dugme koje ništa ne radi; sada je ćelija sa punim imenom dana.
                aria-label={label}
                title={label}
                className={`rounded-md border p-2 text-left ${entry ? 'bg-secondary' : ''}`}
              >
                <span aria-hidden="true">{day.slice(-2)}</span>
                {entry ? (
                  <span aria-hidden="true" className="mt-1 block truncate text-[10px]">
                    {entry.workDescription}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
        {entries.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('diary.emptyHint')}</p>
        ) : null}
        {rows.length > 0 ? (
          <section aria-labelledby="diary-entries" className="grid gap-1">
            <h2 id="diary-entries" className="text-lg font-medium">
              {t('diary.entries')}
            </h2>
            <ul className="text-sm">
              {rows.map((row) => (
                <li key={row.id}>
                  {row.date} · {row.workDescription ?? t('projects.dash')}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {entries.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('diary.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void entries.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      {projectId ? (
        <section aria-labelledby="diary-project" className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="diary-project" className="text-lg font-medium">
              {projectName ?? t('projects.title')}
            </h2>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/projects/${projectId}`}>{t('diary.openProject')}</Link>
            </Button>
          </div>
          <ProjectDiaryTab projectId={projectId} />
        </section>
      ) : null}
    </div>
  )
}
