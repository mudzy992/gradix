import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listProjects } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProjectSheet } from '@/components/ops/project-sheet'
import type { ProjectRow } from '@/lib/ops-types'

export function ProjectsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('projects.write')
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<ProjectRow | null | undefined>(undefined)
  const query = useQuery({
    queryKey: ['projects', { page, q }],
    queryFn: async () => listProjects({ page, q: q || undefined, limit: 20 }),
    enabled: tenantReady,
  })
  const rows = query.data?.data ?? []
  const total = query.data?.meta?.total ?? 0
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('projects.title')}</h1>
        {canWrite ? <Button onClick={() => setEditing(null)}>{t('projects.create')}</Button> : null}
      </div>
      <Input className="max-w-xs" placeholder={t('users.search')} value={q} onChange={(event) => setQ(event.target.value)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('projects.name')}</TableHead>
            <TableHead>{t('projects.status')}</TableHead>
            <TableHead>{t('projects.progress')}</TableHead>
            <TableHead>{t('projects.spend')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link className="font-medium underline-offset-4 hover:underline" to={`/projects/${row.id}`}>
                  {row.name}
                </Link>
              </TableCell>
              <TableCell><Badge variant="secondary">{row.status}</Badge></TableCell>
              <TableCell>{row.progressPercent}%</TableCell>
              <TableCell>
                {row.plannedBudget
                  ? `${dash(row.currentSpend)} / ${row.plannedBudget}`
                  : t('projects.dash')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          {t('common.prev')}
        </Button>
        <Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)}>
          {t('common.next')}
        </Button>
      </div>
      {editing !== undefined ? (
        <ProjectSheet
          project={editing}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['projects'] })}
        />
      ) : null}
    </div>
  )
}
