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
import { displayName } from '@/lib/roles'
import type { ProjectRow } from '@/lib/ops-types'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TabsContent } from '@/components/ui/tabs'
import { QuantitiesTab } from '@/components/ops/quantities-tab'
import { ProjectDiaryTab } from '@/components/ops/project-diary-tab'

const STATUSES = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const

type Props = { projectId: string; project: ProjectRow }

export function ProjectTabs({ projectId, project }: Props) {
  const { t } = useTranslation()
  const canWrite = useHasPermission('projects.write')
  const client = useQueryClient()
  const phases = useQuery({ queryKey: ['phases', projectId], queryFn: async () => (await listPhases(projectId)).data })
  const team = useQuery({ queryKey: ['assignments', projectId], queryFn: async () => (await listAssignments(projectId)).data })
  const users = useQuery({ queryKey: ['users', { limit: 100 }], queryFn: async () => (await listUsers({ limit: 100 })).data })
  const docs = useQuery({ queryKey: ['documents', projectId], queryFn: async () => (await listDocuments(projectId)).data })
  const machines = useQuery({
    queryKey: ['machines', { projectId }],
    queryFn: async () => (await listMachines({ projectId, limit: 100 })).data,
  })
  const trips = useQuery({
    queryKey: ['trips', { projectId }],
    queryFn: async () => (await listTrips({ projectId, limit: 100 })).data,
  })
  const taskRows = useQuery({
    queryKey: ['tasks', { projectId, limit: 100 }],
    queryFn: async () => (await listTasks({ projectId, limit: 100 })).data,
  })
  const fuel = useQuery({
    queryKey: ['fuel', { projectId }],
    queryFn: async () => (await listFuel({ projectId })).data,
  })
  const status = useMutation({
    mutationFn: (value: string) => patchProjectStatus(projectId, value),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <>
      <TabsContent value="phases" className="grid gap-3 pt-4">
        {canWrite ? (
          <Button
            onClick={async () => {
              const name = window.prompt(t('projects.addPhase'))
              if (!name) return
              try {
                await createPhase(projectId, { name })
                await client.invalidateQueries({ queryKey: ['phases', projectId] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            {t('projects.addPhase')}
          </Button>
        ) : null}
        <ul className="grid gap-2 text-sm">
          {(phases.data ?? []).map((phase) => (
            <li key={phase.id}>{phase.name} · {phase.progressPercent}%</li>
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="tasks" className="grid gap-2 pt-4 text-sm">
        {(taskRows.data ?? []).map((row) => (
          <Link key={row.id} className="rounded-md border p-2 hover:bg-secondary" to={`/tasks/${row.id}`}>
            {row.title} · {row.status}
          </Link>
        ))}
      </TabsContent>
      <TabsContent value="team" className="grid gap-3 pt-4">
        {(team.data ?? []).map((row) => (
          <div key={row.id} className="flex items-center justify-between text-sm">
            <span>{row.user ? displayName(row.user) : row.userId} · {row.role}</span>
            {canWrite ? (
              <Button variant="ghost" size="sm" onClick={() => removeAssignment(projectId, row.userId).then(() => client.invalidateQueries({ queryKey: ['assignments', projectId] }))}>
                {t('common.cancel')}
              </Button>
            ) : null}
          </div>
        ))}
        {canWrite ? (
          <select
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            defaultValue=""
            onChange={async (event) => {
              const userId = event.target.value
              if (!userId) return
              try {
                await createAssignment(projectId, { userId, role: 'WORKER' })
                await client.invalidateQueries({ queryKey: ['assignments', projectId] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
              event.target.value = ''
            }}
          >
            <option value="">{t('projects.addMember')}</option>
            {(users.data ?? []).map((user) => (
              <option key={user.id} value={user.id}>{displayName(user)}</option>
            ))}
          </select>
        ) : null}
      </TabsContent>
      <TabsContent value="machines" className="grid gap-2 pt-4 text-sm">
        {(machines.data ?? []).map((row) => (
          <div key={row.id}>{row.name} · {row.status}</div>
        ))}
      </TabsContent>
      <TabsContent value="trips" className="grid gap-2 pt-4 text-sm">
        {(trips.data ?? []).map((row) => (
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
        {(docs.data ?? []).map((row) => (
          <div key={row.id} className="text-sm">{row.fileName}</div>
        ))}
        {canWrite ? (
          <Input
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              try {
                const uploaded = await uploadFile(file)
                await createDocument(projectId, { path: uploaded.data.path, fileName: file.name })
                await client.invalidateQueries({ queryKey: ['documents', projectId] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          />
        ) : null}
      </TabsContent>
      <TabsContent value="costs" className="grid gap-2 pt-4 text-sm">
        {(fuel.data ?? []).map((row) => (
          <div key={row.id}>{row.liters} L · {row.totalCost}</div>
        ))}
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((item) => (
              <Button key={item} variant={project.status === item ? 'default' : 'outline'} size="sm" onClick={() => status.mutate(item)}>
                {item}
              </Button>
            ))}
          </div>
        ) : null}
      </TabsContent>
    </>
  )
}
