import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProject, listPhases, listTasks } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { projectStatus } from '@/lib/labels'
import { useHasPermission } from '@/hooks/use-me'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlannedGantt } from '@/components/ops/planned-gantt'
import { ProjectTabs } from '@/components/ops/project-tabs'
import { ProjectPublicCard } from '@/components/ops/project-public-card'
import { Button } from '@/components/ui/button'

const TABS = [
  'overview',
  'phases',
  'tasks',
  'team',
  'machines',
  'trips',
  'quantities',
  'diary',
  'documents',
  'costs',
] as const

export function ProjectDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const qtyRead = useHasPermission('quantities.read')
  const publicWrite = useHasPermission('public.write')
  const tab = params.get('tab') ?? 'overview'
  const project = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await getProject(id)).data,
    enabled: Boolean(id),
  })
  const phases = useQuery({
    queryKey: ['phases', id],
    queryFn: async () => (await listPhases(id)).data,
    enabled: Boolean(id),
  })
  const tasks = useQuery({
    queryKey: ['tasks', { projectId: id, limit: 100 }],
    queryFn: async () => (await listTasks({ projectId: id, limit: 100 })).data,
    enabled: Boolean(id),
  })
  const row = project.data
  if (project.isError) {
    return (
      <div
        role="alert"
        className="flex max-w-xl flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
      >
        <span>{t('projects.loadError')}</span>
        <Button size="sm" variant="outline" onClick={() => void project.refetch()}>
          {t('dashboard.retry')}
        </Button>
      </div>
    )
  }
  if (!row) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
        <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded bg-muted" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    )
  }
  const status = projectStatus(row.status)
  const visibleTabs = TABS.filter((item) => item !== 'quantities' || qtyRead)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
        <Badge variant={status.tone}>{t(status.labelKey, { defaultValue: row.status })}</Badge>
      </div>
      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList variant="line" className="h-auto flex-wrap">
          {visibleTabs.map((item) => (
            <TabsTrigger key={item} value={item}>
              {t(`projects.${item}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="grid gap-4 pt-4">
          {/* FE-08: `dt`/`dd` parovi — prije su to bili `div`-ovi sa dvotačkom u tekstu, što
              čitač ekrana čita kao običan tekst (WCAG 1.3.1). */}
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('projects.progress')}</dt>
              <dd className="font-medium">{row.progressPercent}%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('projects.spend')}</dt>
              <dd className="font-medium">
                {row.plannedBudget ? `${dash(row.currentSpend)} / ${row.plannedBudget}` : t('projects.dash')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('projects.locality')}</dt>
              <dd>{dash(row.locality)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('projects.client')}</dt>
              <dd>{dash(row.client)}</dd>
            </div>
          </dl>
          <h2 className="text-lg font-medium">{t('projects.gantt')}</h2>
          <PlannedGantt phases={phases.data ?? []} tasks={tasks.data ?? []} />
          {publicWrite ? (
            <ProjectPublicCard
              projectId={id}
              isPublic={Boolean(row.isPublic)}
              coverAssetId={row.coverAssetId ?? null}
            />
          ) : null}
        </TabsContent>
        <ProjectTabs projectId={id} project={row} />
      </Tabs>
    </div>
  )
}
