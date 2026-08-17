import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getProject, listPhases, listTasks } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { useHasPermission } from '@/hooks/use-me'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlannedGantt } from '@/components/ops/planned-gantt'
import { ProjectTabs } from '@/components/ops/project-tabs'
import { ProjectPublicCard } from '@/components/ops/project-public-card'

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
  if (!row) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const visibleTabs = TABS.filter((item) => item !== 'quantities' || qtyRead)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
        <Badge variant="secondary">{row.status}</Badge>
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
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>{t('projects.progress')}: {row.progressPercent}%</div>
            <div>
              {t('projects.spend')}:{' '}
              {row.plannedBudget ? `${dash(row.currentSpend)} / ${row.plannedBudget}` : t('projects.dash')}
            </div>
            <div>{t('projects.locality')}: {dash(row.locality)}</div>
            <div>{t('projects.client')}: {dash(row.client)}</div>
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
