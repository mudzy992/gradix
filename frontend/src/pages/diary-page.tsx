import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { listDiary, listProjects } from '@/lib/api-ops'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useDisplayPrefs } from '@/hooks/use-public-settings'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ProjectDiaryTab } from '@/components/ops/project-diary-tab'

export function DiaryPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const prefs = useDisplayPrefs()
  const [params, setParams] = useSearchParams()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
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
  const byDate = new Map((entries.data ?? []).map((row) => [row.date, row]))
  const days = useMemo(() => {
    const [year, mon] = month.split('-').map(Number)
    const last = new Date(Date.UTC(year, mon, 0)).getUTCDate()
    return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  }, [month])
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('diary.title')}</h1>
      <p className="text-xs text-muted-foreground">{prefs.timeZone}</p>
      <div className="flex flex-wrap gap-3">
        <input
          type="month"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        <Select value={projectId || undefined} onValueChange={(value) => setParams(value ? { projectId: value } : {})}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder={t('projects.title')} />
          </SelectTrigger>
          <SelectContent>
            {(projects.data ?? []).map((row) => (
              <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {days.map((day) => (
          <button
            key={day}
            type="button"
            className={`rounded-md border p-2 text-left ${byDate.has(day) ? 'bg-secondary' : ''}`}
            onClick={() => projectId && setParams({ projectId })}
          >
            {day.slice(-2)}
            {byDate.has(day) ? <span className="mt-1 block truncate">{byDate.get(day)?.workDescription}</span> : null}
          </button>
        ))}
      </div>
      {projectId ? <ProjectDiaryTab projectId={projectId} /> : null}
    </div>
  )
}
