import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listTasks } from '@/lib/api-ops'
import { taskPriority, taskStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DispatchSheet } from '@/components/ops/dispatch-sheet'
import type { TaskRow } from '@/lib/ops-types'

/** Kolone table = statusi zadatka (`TaskStatus` u šemi), redom kako posao teče. */
const COLUMNS = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'] as const

export function TasksPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWriteTasks = useHasPermission('tasks.write')
  const canDispatchTasks = useHasPermission('tasks.dispatch')
  const canDispatch = canWriteTasks || canDispatchTasks
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['tasks', { limit: 100 }],
    queryFn: async () => (await listTasks({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const rows = query.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('tasks.title')}</h1>
        {canDispatch ? <Button onClick={() => setOpen(true)}>{t('tasks.create')}</Button> : null}
      </div>

      <p className="text-sm text-muted-foreground" role="status">
        {query.isSuccess ? t('tasks.count', { count: rows.length }) : null}
      </p>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('tasks.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <div
        className="grid gap-3 overflow-x-auto md:grid-cols-5"
        aria-busy={query.isLoading}
        role="region"
        aria-label={t('tasks.board')}
      >
        {COLUMNS.map((status) => {
          const column = rows.filter((row) => row.status === status)
          const meta = taskStatus(status)
          return (
            <section
              key={status}
              aria-labelledby={`tasks-column-${status}`}
              className="min-w-48 rounded-lg border bg-card p-3"
            >
              <h2
                id={`tasks-column-${status}`}
                className="mb-2 flex items-center justify-between gap-2 text-sm font-medium"
              >
                <span>{t(meta.labelKey, { defaultValue: status })}</span>
                <Badge variant="secondary">{column.length}</Badge>
              </h2>
              {query.isLoading ? (
                <div className="grid gap-2">
                  <div className="h-12 animate-pulse rounded-md bg-muted" />
                  <div className="h-12 animate-pulse rounded-md bg-muted" />
                </div>
              ) : column.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('tasks.emptyColumn')}</p>
              ) : (
                <ul className="grid gap-2">
                  {column.map((row) => (
                    <TaskCard key={row.id} row={row} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <DispatchSheet
        open={open}
        onOpenChange={setOpen}
        onSaved={() => void client.invalidateQueries({ queryKey: ['tasks'] })}
      />
    </div>
  )
}

function TaskCard({ row }: { row: TaskRow }) {
  const { t } = useTranslation()
  const priority = taskPriority(row.priority)
  return (
    <li>
      <Link className="block rounded-md border p-2 text-sm hover:bg-secondary" to={`/tasks/${row.id}`}>
        <p className="font-medium">{row.title}</p>
        <Badge variant={priority.tone} className="mt-1">
          {t(priority.labelKey, { defaultValue: row.priority })}
        </Badge>
      </Link>
    </li>
  )
}
