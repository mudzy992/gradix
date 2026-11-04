import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  approvePayrollSession,
  exportPayroll,
  getPayrollSummary,
  listPayrollSessions,
  rejectPayrollSession,
} from '@/lib/api-payroll'
import { canDecidePayroll, canExportPayroll } from '@/lib/payroll-access'
import { errorMessage } from '@/lib/error-message'
import { formatAmount, formatDuration, payrollStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const now = new Date()

/**
 * FE-12 — obračun sati. Nalazi: trajanje i zbroj su se prikazivali **sirovo u minutama**
 * (`480`, dok labela kaže „minuti“), iznosi kao `120.000000` bez formata, a status `REJECTED` je imao
 * isti ton kao `PENDING`. Tabela nije imala `caption`, skeleton, prazno stanje ni grešku, akcijska
 * kolona nije imala zaglavlje, a export je brisao `objectURL` odmah poslije `click()`.
 */
export function PayrollPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const user = useAuthStore((state) => state.user)
  const client = useQueryClient()
  const canExport = canExportPayroll(user)
  const canDecide = canDecidePayroll(user)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const query = { year, month, limit: 100 }
  const sessions = useQuery({
    queryKey: ['payroll-sessions', year, month],
    queryFn: async () => listPayrollSessions(query),
    enabled: tenantReady,
  })
  const summary = useQuery({
    queryKey: ['payroll-summary', year, month],
    queryFn: async () => (await getPayrollSummary(query)).data,
    // FE-12: zbroj je dostupan svakome kome je ekran dostupan; prije je zavisio od prava na export,
    // pa nadzornik bez `payroll.read` nije vidio ni svoj zbroj.
    enabled: tenantReady,
  })
  const rows = sessions.data?.data ?? []
  const totals = summary.data
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['payroll-sessions'] })
    await client.invalidateQueries({ queryKey: ['payroll-summary'] })
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('payroll.title')}</h1>
        {canExport ? (
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={async () => {
              try {
                const blob = await exportPayroll(query)
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = t('payroll.exportName', { year, month })
                document.body.append(link)
                link.click()
                link.remove()
                // FE-12: brisanje URL-a odmah je otkazivalo preuzimanje u nekim browserima.
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            {t('payroll.export')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('payroll.hint')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="payroll-year">
            {t('payroll.year')}
          </label>
          <input
            id="payroll-year"
            type="number"
            min={2000}
            max={2100}
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </div>
        <div className="grid gap-1">
          <label className="text-xs text-muted-foreground" htmlFor="payroll-month">
            {t('payroll.month')}
          </label>
          <select
            id="payroll-month"
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      {totals ? (
        <section aria-labelledby="payroll-summary" className="grid gap-2">
          <h2 id="payroll-summary" className="text-lg font-medium">
            {t('payroll.summaryLabel', { month, year })}
          </h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-4">
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">{t('payroll.approvedTime')}</dt>
              <dd className="text-lg font-medium">{formatDuration(totals.approvedMinutes)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">{t('payroll.approvedAmount')}</dt>
              <dd className="text-lg font-medium">{formatAmount(totals.approvedAmount)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">{t('payroll.pending')}</dt>
              <dd className="text-lg font-medium">{totals.pendingCount}</dd>
              <dd className="text-xs text-muted-foreground">{formatDuration(totals.pendingMinutes)}</dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-muted-foreground">{t('payroll.rejected')}</dt>
              <dd className="text-lg font-medium">{totals.rejectedCount}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div aria-busy={sessions.isLoading}>
        <Table label={t('payroll.title')}>
          <TableCaption className="text-left text-sm text-muted-foreground">
            {sessions.isSuccess
              ? rows.length > 0
                ? t('payroll.count', { count: rows.length })
                : t('payroll.empty')
              : null}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payroll.user')}</TableHead>
              <TableHead>{t('payroll.project')}</TableHead>
              <TableHead>{t('payroll.task')}</TableHead>
              <TableHead>{t('payroll.duration')}</TableHead>
              <TableHead>{t('payroll.amount')}</TableHead>
              <TableHead>{t('payroll.status')}</TableHead>
              {canDecide ? <TableHead>{t('payroll.actions')}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={canDecide ? 7 : 6}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const meta = payrollStatus(row.approvalStatus)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.userName}</TableCell>
                      <TableCell>{row.projectName}</TableCell>
                      <TableCell>{row.taskTitle}</TableCell>
                      <TableCell>{formatDuration(row.durationMinutes)}</TableCell>
                      <TableCell>{formatAmount(row.amount)}</TableCell>
                      <TableCell>
                        <Badge variant={meta.tone}>
                          {t(meta.labelKey, {
                            defaultValue: row.approvalStatus,
                          })}
                        </Badge>
                      </TableCell>
                      {canDecide ? (
                        <TableCell>
                          {row.approvalStatus === 'PENDING' ? (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={() =>
                                  approvePayrollSession(row.id)
                                    .then(refresh)
                                    .catch((error) => toast.error(errorMessage(error)))
                                }
                              >
                                {t('payroll.approve')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  rejectPayrollSession(row.id)
                                    .then(refresh)
                                    .catch((error) => toast.error(errorMessage(error)))
                                }
                              >
                                {t('payroll.reject')}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t('payroll.decidedHint')}</span>
                          )}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  )
                })}
            {sessions.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canDecide ? 7 : 6} className="text-sm text-muted-foreground">
                  {t('payroll.emptyHint')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {sessions.isError || summary.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('payroll.loadError')}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void sessions.refetch()
              void summary.refetch()
            }}
          >
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
