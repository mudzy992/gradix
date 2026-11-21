import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listProjects } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { projectStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ProjectSheet } from '@/components/ops/project-sheet'
import type { ProjectRow } from '@/lib/ops-types'

const PAGE_SIZE = 20

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
    queryFn: async () => listProjects({ page, q: q || undefined, limit: PAGE_SIZE }),
    enabled: tenantReady,
  })
  const rows = query.data?.data ?? []
  const total = query.data?.meta?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('projects.title')}</h1>
        {canWrite ? <Button onClick={() => setEditing(null)}>{t('projects.create')}</Button> : null}
      </div>

      <div className="grid gap-1">
        {/* FE-08: polje pretrage ima pristupačno ime; placeholder nije labela (WCAG 3.3.2). */}
        <label className="sr-only" htmlFor="projects-search">
          {t('projects.search')}
        </label>
        <Input
          id="projects-search"
          type="search"
          className="max-w-xs"
          placeholder={t('projects.searchPlaceholder')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
        />
      </div>

      <div aria-busy={query.isLoading}>
        <Table label={t('projects.title')}>
          <TableCaption className="text-left text-sm text-muted-foreground">
            {query.isSuccess
              ? total > 0
                ? t('projects.count', { count: total })
                : t('projects.empty')
              : null}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('projects.name')}</TableHead>
              <TableHead>{t('projects.status')}</TableHead>
              <TableHead>{t('projects.progress')}</TableHead>
              <TableHead>{t('projects.spend')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading
              ? [0, 1, 2, 3].map((index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={4}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const status = projectStatus(row.status)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          className="font-medium underline-offset-4 hover:underline"
                          to={`/projects/${row.id}`}
                        >
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.tone}>
                          {t(status.labelKey, { defaultValue: row.status })}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.progressPercent}%</TableCell>
                      <TableCell>
                        {row.plannedBudget
                          ? `${dash(row.currentSpend)} / ${row.plannedBudget}`
                          : t('projects.dash')}
                      </TableCell>
                    </TableRow>
                  )
                })}
            {query.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  {q ? t('projects.noMatch', { q }) : t('projects.emptyHint')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('projects.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav className="flex flex-wrap items-center gap-2" aria-label={t('common.pagination')}>
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            {t('common.prev')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('common.pageOf', { page, pages })}
          </span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
            {t('common.next')}
          </Button>
        </nav>
      ) : null}

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
