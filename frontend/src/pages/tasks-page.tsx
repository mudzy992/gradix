import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listTasks } from '@/lib/api-ops'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DispatchSheet } from '@/components/ops/dispatch-sheet'
import type { TaskRow } from '@/lib/ops-types'

const COLUMNS = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED'] as const

export function TasksPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canDispatch = useHasPermission('tasks.write') || useHasPermission('tasks.dispatch')
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
      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {COLUMNS.map((status) => (
          <section key={status} className="min-w-48 rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-medium">{status}</h2>
            <ul className="grid gap-2">
              {rows.filter((row) => row.status === status).map((row) => (
                <TaskCard key={row.id} row={row} />
              ))}
            </ul>
          </section>
        ))}
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
  return (
    <li>
      <Link className="block rounded-md border p-2 text-sm hover:bg-secondary" to={`/tasks/${row.id}`}>
        <p className="font-medium">{row.title}</p>
        <Badge variant="secondary" className="mt-1">{row.priority}</Badge>
      </Link>
    </li>
  )
}
