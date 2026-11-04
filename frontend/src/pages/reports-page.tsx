import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { exportReport, getReport } from '@/lib/api-polish'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SLUGS = [
  'project-spend',
  'machine-hours',
  'fuel-summary',
  'trips-summary',
  'tender-comparison',
  'phase-quantities',
] as const

/**
 * FE-11 — izvještaji. Nalazi: zaglavlja kolona su bila **sirovi ključevi sa backenda**
 * (`plannedBudget`, `avgCompletedSpend`), tabela nije imala `caption`, nije bilo stanja
 * (učitavanje/greška/prazno), a export je brisao `objectURL` odmah poslije `click()` — u nekim
 * browserima preuzimanje bi se otkazalo. Sada: prevedena zaglavlja sa `defaultValue` (nepoznata
 * kolona se vidi sirova, pa se primjećuje), caption sa brojem redova, stanja i sigurniji export.
 */
export function ReportsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canExport = useHasPermission('reports.export')
  const [slug, setSlug] = useState<(typeof SLUGS)[number]>('project-spend')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const query = useQuery({
    queryKey: ['report', slug, { from, to }],
    queryFn: async () => (await getReport(slug, { from: from || undefined, to: to || undefined })).data,
    enabled: tenantReady,
  })
  const table = query.data
  const reportName = t(`reports.slugs.${slug}`)
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('reports.title')}</h1>
        {canExport ? (
          <Button
            variant="outline"
            disabled={!table || table.rows.length === 0}
            onClick={async () => {
              try {
                const blob = await exportReport(slug, { from: from || undefined, to: to || undefined })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `${slug}.xlsx`
                document.body.append(link)
                link.click()
                link.remove()
                // FE-11: brisanje URL-a odmah je otkazivalo preuzimanje u nekim browserima.
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            {t('reports.export')}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="report-slug">
            {t('reports.slug')}
          </label>
          <select
            id="report-slug"
            className="h-9 max-w-sm rounded-md border border-input bg-transparent px-2 text-sm"
            value={slug}
            onChange={(event) => setSlug(event.target.value as (typeof SLUGS)[number])}
          >
            {SLUGS.map((item) => (
              <option key={item} value={item}>
                {t(`reports.slugs.${item}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="report-from">
            {t('reports.from')}
          </label>
          <Input id="report-from" type="date" className="w-40" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="report-to">
            {t('reports.to')}
          </label>
          <Input id="report-to" type="date" className="w-40" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
      </div>

      <div aria-busy={query.isLoading}>
        <Table>
          <TableCaption className="text-left text-sm text-muted-foreground">
            {table
              ? t('reports.caption', { name: reportName, count: table.rows.length })
              : null}
          </TableCaption>
          <TableHeader>
            <TableRow>
              {(table?.columns ?? []).map((col) => (
                <TableHead key={col}>{t(`reports.columns.${col}`, { defaultValue: col })}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={4}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : (table?.rows ?? []).map((row, index) => (
                  <TableRow key={index}>
                    {(table?.columns ?? []).map((col) => (
                      <TableCell key={col}>{row[col] ?? t('projects.dash')}</TableCell>
                    ))}
                  </TableRow>
                ))}
            {table && table.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={Math.max(1, table.columns.length)} className="text-sm text-muted-foreground">
                  {t('reports.empty')}
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
          <span>{t('reports.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
