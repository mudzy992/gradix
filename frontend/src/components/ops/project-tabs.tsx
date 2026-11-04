import { useEffect, useState } from 'react'
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
import { ApiError, type MeUser } from '@/lib/api-types'
import { getSessionGeneration } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { assignmentRole, machineStatus, projectStatus, taskStatus } from '@/lib/labels'
import { displayName } from '@/lib/roles'
import type { ProjectRow } from '@/lib/ops-types'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TabsContent } from '@/components/ui/tabs'
import { QuantitiesTab } from '@/components/ops/quantities-tab'
import { ProjectDiaryTab } from '@/components/ops/project-diary-tab'
import { ProjectPagination } from '@/components/ops/project-pagination'

const ASSIGNMENT_ROLES = ['PM', 'SS', 'WORKER', 'DRIVER', 'OP'] as const
type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]
type PendingDocument = { path: string; fileName: string; idempotencyKey: string }
type PendingDocumentState = { idempotencyKey: string; inFlight: boolean; reference?: PendingDocument }
const pendingDocumentKey = (scope: string) => ['project-document-pending', scope] as const

function documentScope(projectId: string, user: MeUser | null, selectedCompany: string | null): string {
  const company = user?.roles?.includes('PLATFORM_ADMIN') ? selectedCompany : user?.companyId ?? null
  return JSON.stringify([getSessionGeneration(), user?.id ?? null, company, projectId])
}

function ensureDocumentScope(projectId: string, expected: string): void {
  const current = documentScope(projectId, useAuthStore.getState().user, useCompanyStore.getState().selectedId)
  if (current !== expected) throw new ApiError('SESSION_CHANGED', 'Session or company changed; retry the operation', 409)
}

const STATUSES = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const

type Props = { projectId: string; project: ProjectRow; activeTab: string }

type ListState = {
  isLoading: boolean
  isError: boolean
  data: unknown[] | { data: unknown[] } | undefined
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
  const items = Array.isArray(query.data) ? query.data : query.data?.data
  if (items?.length === 0) return <p className="text-sm text-muted-foreground">{t('projects.sectionEmpty')}</p>
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
  const user = useAuthStore((state) => state.user)
  const selectedCompany = useCompanyStore((state) => state.selectedId)
  const currentDocumentScope = documentScope(projectId, user, selectedCompany)
  const [memberSearchInput, setMemberSearchInput] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [memberPage, setMemberPage] = useState(1)
  const [memberId, setMemberId] = useState('')
  const [memberRole, setMemberRole] = useState<AssignmentRole>('WORKER')
  const [taskPage, setTaskPage] = useState(1)
  const [machinePage, setMachinePage] = useState(1)
  const [tripPage, setTripPage] = useState(1)
  const [fuelPage, setFuelPage] = useState(1)
  // This in-memory cache survives route unmounts and is cleared with the session.
  const pendingDocumentState = useQuery<PendingDocumentState | null>({
    queryKey: pendingDocumentKey(currentDocumentScope), queryFn: async () => null, enabled: false, gcTime: Infinity,
  }).data
  const pendingDocument = pendingDocumentState?.reference ?? null
  useEffect(() => {
    setMemberSearchInput('')
    setMemberSearch('')
    setMemberPage(1)
    setMemberId('')
    setMemberRole('WORKER')
    setTaskPage(1)
    setMachinePage(1)
    setTripPage(1)
    setFuelPage(1)
  }, [projectId])
  const phases = useQuery({ queryKey: ['phases', projectId], queryFn: async () => (await listPhases(projectId)).data, enabled: activeTab === 'phases' })
  const team = useQuery({ queryKey: ['assignments', projectId], queryFn: async () => (await listAssignments(projectId)).data, enabled: activeTab === 'team' })
  const users = useQuery({
    queryKey: ['users', 'project-pages', { page: memberPage, q: memberSearch, limit: 100 }],
    queryFn: () => listUsers({ page: memberPage, q: memberSearch || undefined, limit: 100 }),
    enabled: activeTab === 'team' && canWrite && canReadUsers,
  })
  const docs = useQuery({ queryKey: ['documents', projectId], queryFn: async () => (await listDocuments(projectId)).data, enabled: activeTab === 'documents' })
  const machines = useQuery({
    queryKey: ['machines', 'project-pages', { projectId, page: machinePage, limit: 100 }],
    queryFn: () => listMachines({ projectId, page: machinePage, limit: 100 }),
    enabled: activeTab === 'machines' && canReadFleet,
  })
  const trips = useQuery({
    queryKey: ['trips', 'project-pages', { projectId, page: tripPage, limit: 100 }],
    queryFn: () => listTrips({ projectId, page: tripPage, limit: 100 }),
    enabled: activeTab === 'trips' && canReadTrips,
  })
  const taskRows = useQuery({
    queryKey: ['tasks', 'project-pages', { projectId, page: taskPage, limit: 100 }],
    queryFn: () => listTasks({ projectId, page: taskPage, limit: 100 }),
    enabled: activeTab === 'tasks' && canReadTasks,
  })
  const fuel = useQuery({
    queryKey: ['fuel', 'project-pages', { projectId, page: fuelPage }],
    queryFn: () => listFuel({ projectId, page: fuelPage }),
    enabled: activeTab === 'costs' && canReadFuel,
  })
  const availableUsers = (users.data?.data ?? []).filter((user) => user.isActive && !(team.data ?? []).some((row) => row.userId === user.id))
  const memberIsAvailable = availableUsers.some((user) => user.id === memberId)
  const phaseCreate = useMutation({
    mutationFn: (name: string) => createPhase(projectId, { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['phases', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const assignmentAdd = useMutation({
    mutationFn: (body: { userId: string; role: AssignmentRole }) => createAssignment(projectId, body),
    onSuccess: () => {
      setMemberId('')
      return client.invalidateQueries({ queryKey: ['assignments', projectId] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const assignmentRemove = useMutation({
    mutationFn: (userId: string) => removeAssignment(projectId, userId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['assignments', projectId] }),
    onError: (error) => toast.error(errorMessage(error)),
  })
  const documentUpload = useMutation({
    mutationFn: async (input: { projectId: string; scope: string; file: File } | { projectId: string; scope: string; pending: PendingDocument }) => {
      ensureDocumentScope(input.projectId, input.scope)
      const key = pendingDocumentKey(input.scope)
      const previous = client.getQueryData<PendingDocumentState | null>(key)
      let idempotencyKey: string
      if ('pending' in input) {
        if (!previous || previous.inFlight || previous.idempotencyKey !== input.pending.idempotencyKey) {
          throw new Error('Document operation is no longer available')
        }
        idempotencyKey = input.pending.idempotencyKey
        client.setQueryData(key, { ...previous, inFlight: true })
      } else {
        if (previous) throw new Error('Document operation is already pending')
        // Generate before upload so an unavailable secure UUID cannot orphan a file.
        idempotencyKey = crypto.randomUUID()
        client.setQueryData(key, { idempotencyKey, inFlight: true } satisfies PendingDocumentState)
      }
      const current = () => client.getQueryData<PendingDocumentState | null>(key)
      const ensureOperation = () => {
        ensureDocumentScope(input.projectId, input.scope)
        if (current()?.idempotencyKey !== idempotencyKey) {
          throw new ApiError('SESSION_CHANGED', 'Session or company changed; retry the operation', 409)
        }
      }
      try {
        if ('pending' in input) {
          // Reconcile a response lost after creation before retrying the link.
          const existing = await listDocuments(input.projectId)
          ensureOperation()
          const found = existing.data.find((item) => item.path === input.pending.path && item.fileName === input.pending.fileName)
          if (!found) await createDocument(input.projectId, input.pending)
        } else {
          const uploaded = await uploadFile(input.file)
          ensureOperation()
          const reference = { path: uploaded.data.path, fileName: input.file.name, idempotencyKey }
          client.setQueryData(key, { idempotencyKey, inFlight: true, reference } satisfies PendingDocumentState)
          await createDocument(input.projectId, reference)
        }
        return { projectId: input.projectId, scope: input.scope, idempotencyKey }
      } catch (error) {
        const state = current()
        if (state?.idempotencyKey === idempotencyKey) {
          client.setQueryData(key, state.reference ? { ...state, inFlight: false } : null)
        }
        throw error
      }
    },
    onSuccess: ({ projectId: targetId, scope, idempotencyKey }) => {
      const key = pendingDocumentKey(scope)
      const state = client.getQueryData<PendingDocumentState | null>(key)
      if (state?.idempotencyKey === idempotencyKey) client.setQueryData(key, null)
      if (documentScope(targetId, useAuthStore.getState().user, useCompanyStore.getState().selectedId) === scope) {
        return client.invalidateQueries({ queryKey: ['documents', targetId] })
      }
    },
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
        {(canReadTasks ? taskRows.data?.data ?? [] : []).map((row) => (
          <Link key={row.id} className="rounded-md border p-2 hover:bg-secondary" to={`/tasks/${row.id}`}>
            {row.title} · {t(taskStatus(row.status).labelKey, { defaultValue: row.status })}
          </Link>
        ))}
        {canReadTasks ? <ProjectPagination label={t('projects.tasksPagination')} page={taskPage} meta={taskRows.data?.meta} loading={taskRows.isLoading} onPageChange={setTaskPage} /> : null}
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
                <form className="grid gap-2" onSubmit={(event) => {
                  event.preventDefault()
                  setMemberId('')
                  setMemberPage(1)
                  setMemberSearch(memberSearchInput.trim())
                }}>
                  <label htmlFor="member-search">{t('projects.searchMembers')}</label>
                  <div className="flex gap-2">
                    <Input id="member-search" value={memberSearchInput} onChange={(event) => setMemberSearchInput(event.target.value)} />
                    <Button type="submit" variant="outline">{t('projects.searchButton')}</Button>
                  </div>
                </form>
                {users.isLoading ? <p role="status">{t('common.loading')}</p> : null}
                {!users.isLoading && !users.isError && !team.isLoading && !team.isError && availableUsers.length === 0 ? <p className="text-sm">{t('projects.noAvailableMembers')}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={t('projects.addMember')}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    value={memberId}
                    disabled={users.isLoading || users.isError || team.isLoading || team.isError || assignmentAdd.isPending}
                    onChange={(event) => setMemberId(event.target.value)}
                  >
                    <option value="">{t('projects.selectMember')}</option>
                    {availableUsers.map((user) => (
                      <option key={user.id} value={user.id}>{displayName(user)}</option>
                    ))}
                  </select>
                  <select
                    aria-label={t('projects.memberRole')}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                    value={memberRole}
                    disabled={assignmentAdd.isPending}
                    onChange={(event) => setMemberRole(event.target.value as AssignmentRole)}
                  >
                    {ASSIGNMENT_ROLES.map((role) => <option key={role} value={role}>{t(assignmentRole(role).labelKey, { defaultValue: role })}</option>)}
                  </select>
                  <Button disabled={!memberIsAvailable || users.isLoading || users.isError || team.isLoading || team.isError || assignmentAdd.isPending}
                    onClick={() => assignmentAdd.mutate({ userId: memberId, role: memberRole })}>{t('projects.addMember')}</Button>
                </div>
                <ProjectPagination label={t('projects.membersPagination')} page={memberPage} meta={users.data?.meta} loading={users.isLoading} onPageChange={(page) => { setMemberId(''); setMemberPage(page) }} />
              </>
            ) : <p className="text-sm">{t('projects.usersNoAccess')}</p>}
          </div>
        ) : null}
      </TabsContent>
      <TabsContent value="machines" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={machines} allowed={canReadFleet} />
        {(canReadFleet ? machines.data?.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.name} · {t(machineStatus(row.status).labelKey, { defaultValue: row.status })}</div>
        ))}
        {canReadFleet ? <ProjectPagination label={t('projects.machinesPagination')} page={machinePage} meta={machines.data?.meta} loading={machines.isLoading} onPageChange={setMachinePage} /> : null}
      </TabsContent>
      <TabsContent value="trips" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={trips} allowed={canReadTrips} />
        {(canReadTrips ? trips.data?.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.originText} · {row.quantity}</div>
        ))}
        {canReadTrips ? <ProjectPagination label={t('projects.tripsPagination')} page={tripPage} meta={trips.data?.meta} loading={trips.isLoading} onPageChange={setTripPage} /> : null}
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
          <>
            {pendingDocumentState?.inFlight && !pendingDocument ? <p role="status">{t('projects.documentUploadInProgress')}</p> : null}
            {pendingDocument ? (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <span>{t('projects.documentLinkPending', { name: pendingDocument.fileName })}</span>
                <Button size="sm" variant="outline" disabled={documentUpload.isPending || pendingDocumentState?.inFlight} onClick={() => documentUpload.mutate({ projectId, scope: currentDocumentScope, pending: pendingDocument })}>{t('projects.retryDocumentLink')}</Button>
              </div>
            ) : null}
            <Input
              type="file"
              aria-label={t('projects.uploadDocument')}
              disabled={documentUpload.isPending || Boolean(pendingDocumentState)}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file && !documentUpload.isPending && !pendingDocumentState) documentUpload.mutate({ projectId, scope: currentDocumentScope, file })
              }}
            />
          </>
        ) : null}
      </TabsContent>
      <TabsContent value="costs" className="grid gap-2 pt-4 text-sm">
        <ListFeedback query={fuel} allowed={canReadFuel} />
        {(canReadFuel ? fuel.data?.data ?? [] : []).map((row) => (
          <div key={row.id}>{row.liters} L · {row.totalCost}</div>
        ))}
        {canReadFuel ? <ProjectPagination label={t('projects.fuelPagination')} page={fuelPage} meta={fuel.data?.meta} loading={fuel.isLoading} onPageChange={setFuelPage} /> : null}
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
