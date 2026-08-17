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
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const now = new Date()

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
    enabled: tenantReady && canExport,
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
            onClick={async () => {
              try {
                const blob = await exportPayroll(query)
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = 'payroll.xlsx'
                link.click()
                URL.revokeObjectURL(url)
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
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm">
          {t('payroll.year')}
          <input
            id="payroll-year"
            type="number"
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('payroll.month')}
          <select
            id="payroll-month"
            className="h-9 w-24 rounded-md border border-input bg-transparent px-2"
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
            aria-label={t('payroll.month')}
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {totals ? (
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">{t('payroll.approvedHours')}</dt>
            <dd className="text-lg font-medium">{totals.approvedMinutes}</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">{t('payroll.approvedAmount')}</dt>
            <dd className="text-lg font-medium">{totals.approvedAmount}</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">{t('payroll.pending')}</dt>
            <dd className="text-lg font-medium">{totals.pendingCount}</dd>
          </div>
          <div className="rounded-md border p-3">
            <dt className="text-muted-foreground">{t('payroll.rejected')}</dt>
            <dd className="text-lg font-medium">{totals.rejectedCount}</dd>
          </div>
        </dl>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('payroll.user')}</TableHead>
            <TableHead>{t('payroll.project')}</TableHead>
            <TableHead>{t('payroll.duration')}</TableHead>
            <TableHead>{t('payroll.amount')}</TableHead>
            <TableHead>{t('payroll.status')}</TableHead>
            {canDecide ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.userName}</TableCell>
              <TableCell>{row.projectName}</TableCell>
              <TableCell>{row.durationMinutes}</TableCell>
              <TableCell>{row.amount}</TableCell>
              <TableCell>
                <Badge variant={row.approvalStatus === 'APPROVED' ? 'secondary' : 'outline'}>
                  {t(`payroll.${row.approvalStatus}`)}
                </Badge>
              </TableCell>
              {canDecide && row.approvalStatus === 'PENDING' ? (
                <TableCell className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => approvePayrollSession(row.id).then(refresh).catch((error) => toast.error(errorMessage(error)))}
                  >
                    {t('payroll.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rejectPayrollSession(row.id).then(refresh).catch((error) => toast.error(errorMessage(error)))}
                  >
                    {t('payroll.reject')}
                  </Button>
                </TableCell>
              ) : canDecide ? <TableCell /> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
