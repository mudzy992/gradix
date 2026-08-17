import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { exportReport, getReport } from '@/lib/api-polish'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const SLUGS = [
  'project-spend',
  'machine-hours',
  'fuel-summary',
  'trips-summary',
  'tender-comparison',
  'phase-quantities',
] as const

export function ReportsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canExport = useHasPermission('reports.export')
  const [slug, setSlug] = useState<(typeof SLUGS)[number]>('project-spend')
  const query = useQuery({
    queryKey: ['report', slug],
    queryFn: async () => (await getReport(slug, {})).data,
    enabled: tenantReady,
  })
  const table = query.data
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('reports.title')}</h1>
        {canExport ? (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const blob = await exportReport(slug, {})
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `${slug}.xlsx`
                link.click()
                URL.revokeObjectURL(url)
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            {t('reports.export')}
          </Button>
        ) : null}
      </div>
      <select
        className="h-9 max-w-sm rounded-md border border-input bg-transparent px-2 text-sm"
        value={slug}
        onChange={(event) => setSlug(event.target.value as (typeof SLUGS)[number])}
        aria-label={t('reports.slug')}
      >
        {SLUGS.map((item) => (
          <option key={item} value={item}>{t(`reports.slugs.${item}`)}</option>
        ))}
      </select>
      {table ? (
        <Table>
          <TableHeader>
            <TableRow>
              {table.columns.map((col) => (
                <TableHead key={col}>{col}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, index) => (
              <TableRow key={index}>
                {table.columns.map((col) => (
                  <TableCell key={col}>{row[col] ?? t('projects.dash')}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
