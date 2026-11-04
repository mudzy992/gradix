import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  createAssignment,
  createDocument,
  createPhase,
  listAssignments,
  listDocuments,
  listPhases,
  listTasks,
  patchProjectStatus,
  removeAssignment,
} from '@/lib/api-ops'
import { listFuel, listMachines, listTrips } from '@/lib/api-fleet'
import { listUsers, uploadFile } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { assignmentRole, machineStatus, projectStatus, taskStatus } from '@/lib/labels'
import { displayName } from '@/lib/roles'
import type { ProjectRow } from '@/lib/ops-types'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TabsContent } from '@/components/ui/tabs'
import { QuantitiesTab } from '@/components/ops/quantities-tab'
import { ProjectDiaryTab } from '@/components/ops/project-diary-tab'

const STATUSES = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const

type Props = { projectId: string; project: ProjectRow; activeTab: string }

type ListState = {
  isLoading: boolean
  isError: boolean
  data: unknown[] | undefined
  refetch: () => unknown
}

function ListFeedback({ query, allowed = true }: { query: ListState; allowed?: boolean }) {
  const { t } = useTranslation()
  if (!allowed) return <p>{t('projects.noAccess')}</p>
  if (query.isLoading) return <p role="status">{t('common.loading')}</p>
  if (query.isError) return (
    <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
      <span>{t('projects.sectionLoadError')}</span>
      <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('dashboard.retry')}</Button>
    </div>
  )
  if (query.data?.length === 0) return <p className="text-sm text-muted-foreground">{t('projects.sectionEmpty')}</p>
  return null
}

export function ProjectTabs({ projectId, project, activeTab }: Props) {
  const { t } = useTranslation()
  const canWrite = useHasPermission('projects.write')
  const canReadUsers = useHasPermission('users.read')
  const canReadTasks = useHasPermission('tasks.read')
  const canReadFleet = useHasPermission('fleet.read')
  const canReadTrips = useHasPermission('trips.read')
  const fuelWrite = useHasPermission('fuel.write')
  const fuelReports = useHasPermission('fuel.reports')
  const canReadFuel = fuelWrite || fuelReports
  const client = useQueryClient()
  const phases = useQuery({ queryKey: ['phases', projectId], queryFn: async () => (await listPhases(projectId)).data, enabled: activeTab === 'phases' })
  const team = useQuery({ queryKey: ['assignments', projectId], queryFn: async () => (await listAssignments(projectId)).data, enabled: activeTab === 'team' })
  const users = useQuery({ queryKey: ['users', { limit: 100 }], queryFn: async () => (await listUsers({ limit: 100 })).data, enabled: activeTab === 'team' && canWrite && canReadUsers })
  const docs = useQuery({ queryKey: ['documents', projectId], queryFn: async () => (await listDocuments(projectId)).data, enabled: activeTab === 'documents' })
  const machines = useQuery({
    queryKey: ['machines', { projectId }],
    queryFn: async () => (await listMachines({ projectId, limit: 100 })).data,
    enabled: activeTab === 'machines' && canReadFleet,
  })
  const trips = useQuery({
    queryKey: ['trips', { projectId }],
    queryFn: async () => (await listTrips({ projectId, limit: 100 })).data,
    enabled: activeTab === 'trips' && canReadTrips,
  })
  const taskRows = useQuery({
    queryKey: ['tasks', { projectId, limit: 100 }],
    queryFn: async () => (await listTasks({ projectId, limit: 100 })).data,
    enabled: activeTab === 'tasks' && canReadTasks,
  })
  const fuel = useQuery({
    queryKey: ['fuel', { projectId }],
    queryFn: async () => (await listFuel({ projectId })).data,
    enabled: activeTab === 'costs' && canReadFuel,
  })
  const phaseCreate = useMutation({
    mutationFn: (name: string) => createPhase(projectId, { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['phases', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const assignmentAdd = useMutation({
    mutationFn: (userId: string) => createAssignment(projectId, { userId, role: 'WORKER' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assignments', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const assignmentRemove = useMutation({
    mutationFn: (userId: string) => removeAssignment(projectId, userId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assignments', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const documentUpload = useMutation({
    mutationFn: async (file: File) => {
      const uploaded = await uploadFile(file)
      return createDocument(projectId, { path: uploaded.data.path, fileName: file.name })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['documents', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const status = useMutation({
    mutationFn: (value: string) => patchProjectStatus(projectId, value),
    onSuccess: () => client.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <>
      <TabsContent value="phases" className="grid gap-3 pt-4">
        {canWrite ? (
          <Button
            disabled={phaseCreate.isPending}
            onClick={() => {
              const name = window.prompt(t('projects.addPhase'))?.trim()
              if (name) phaseCreate.mutate(name)
            }}
          >
            {t('projects.addPhase')}
          </Button>
        ) : null}
        <ListFeedback query={phases} />
        <ul className="grid gap-2 text-sm">
          {(phases.data ?? []).map((phase) => (
            <li key={phase.id}>{phase.name} · {phase.progressPercent}%</li>
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="tasks" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={taskRows} allowed={canReadTasks} />
        {(canReadTasks ? taskRows.data ?? [] : []).map((row) => (
          <Link key={row.id} className="rounded-md border p-2 hover:bg-secondary" to={`/tasks/${row.id}`}>
            {row.title} · {t(taskStatus(row.status).labelKey, { defaultValue: row.status })}
          </Link>
        ))}
      </TabsContent>
      <TabsContent value="team" className="grid gap-3 pt-4">
        <ListFeedback query={team} />
        {(team.data ?? []).map((row) => (
          <div key={row.id} className="flex items-center justify-between text-sm">
            <span>{row.user ? displayName(row.user) : row.userId} · {t(assignmentRole(row.role).labelKey, { defaultValue: row.role })}</span>
            {canWrite ? (
              <Button variant="ghost" size="sm" disabled={assignmentRemove.isPending} aria-label={t('projects.removeMember', { name: row.user ? displayName(row.user) : row.userId })} onClick={() => assignmentRemove.mutate(row.userId)}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        ))}
        {canWrite ? (
          <div className="grid gap-2">
            {canReadUsers ? (
              <>
                {users.isError ? (
                  <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
                    <span>{t('users.loadError')}</span>
                    <Button size="sm" variant="outline" onClick={() => void users.refetch()}>{t('dashboard.retry')}</Button>
                  </div>
                ) : null}
                <select
                  aria-label={t('projects.addMember')}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value=""
                  disabled={users.isLoading || users.isError || assignmentAdd.isPending}
                  onChange={(event) => {
                    if (event.target.value) assignmentAdd.mutate(event.target.value)
                  }}
                >
                  <option value="">{t('projects.addMember')}</option>
                  {(users.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>{displayName(user)}</option>
                  ))}
                </select>
              </>
            ) : <p className="text-sm">{t('projects.usersNoAccess')}</p>}
          </div>
        ) : null}
      </TabsContent>
      <TabsContent value="machines" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={machines} allowed={canReadFleet} />
        {(canReadFleet ? machines.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.name} · {t(machineStatus(row.status).labelKey, { defaultValue: row.status })}</div>
        ))}
      </TabsContent>
      <TabsContent value="trips" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={trips} allowed={canReadTrips} />
        {(canReadTrips ? trips.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.originText} · {row.quantity}</div>
        ))}
      </TabsContent>
      <TabsContent value="quantities" className="pt-4">
        <QuantitiesTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="diary" className="pt-4">
        <ProjectDiaryTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="documents" className="grid gap-3 pt-4">
        <ListFeedback query={docs} />
        {(docs.data ?? []).map((row) => (
          <div key={row.id} className="text-sm">{row.fileName}</div>
        ))}
        {canWrite ? (
          <Input
            type="file"
            aria-label={t('projects.uploadDocument')}
            disabled={documentUpload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file && !documentUpload.isPending) documentUpload.mutate(file)
            }}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="costs" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={fuel} allowed={canReadFuel} />
        {(canReadFuel ? fuel.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.liters} L · {row.totalCost}</div>
        ))}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((item) => (
              <Button key={item} variant={project.status === item ? 'default' : 'outline'} size="sm" disabled={status.isPending} onClick={() => status.mutate(item)}>
                {t(projectStatus(item).labelKey, { defaultValue: item })}
              </Button>
            ))}
          </div>
        ) : null}
      </TabsContent>
    </>
  )
}
