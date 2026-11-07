import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cancelService, completeService, createService, listServices, startService } from '@/lib/api-polish'
import { listMachines } from '@/lib/api-fleet'
import { errorMessage } from '@/lib/error-message'
import { formatAmount, serviceStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * FE-11 — servisni nalozi. Nalazi: status je bio sirov enum (`PLANNED`, `IN_PROGRESS`) sa istim tonom,
 * a umjesto naziva mašine je pisan **`machineId`** (CUID) — korisnik nije mogao znati o kojoj je
 * mašini riječ. Trošak (`totalCost`) se nije prikazivao, nije bilo stanja liste ni povezanih labela.
 */
export function ServicesPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('services.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [machineId, setMachineId] = useState('')
  const [formError, setFormError] = useState('')
  const query = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await listServices({ limit: 50 })).data,
    enabled: tenantReady,
  })
  const machines = useQuery({
    queryKey: ['machines', { limit: 100 }],
    queryFn: async () => (await listMachines({ limit: 100 })).data,
    // FE-11: nazivi mašina trebaju i za listu, ne samo za formu.
    enabled: tenantReady,
  })
  const rows = query.data ?? []
  const machineName = (id: string) => machines.data?.find((row) => row.id === id)?.name ?? id
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('services.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('services.create')}</Button> : null}
      </div>

      <div aria-busy={query.isLoading} className="grid gap-2">
        {query.isSuccess ? (
          <p className="text-sm text-muted-foreground">
            {rows.length > 0 ? t('services.count', { count: rows.length }) : t('services.empty')}
          </p>
        ) : null}
        <ul aria-label={t('services.list')} className="grid gap-2">
          {query.isLoading
            ? [0, 1, 2].map((index) => (
                <li key={`skeleton-${index}`}>
                  <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
                </li>
              ))
            : rows.map((row) => {
                const meta = serviceStatus(row.status)
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.tone}>{t(meta.labelKey, { defaultValue: row.status })}</Badge>
                      <span>{machineName(row.machineId)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('services.cost')}: {formatAmount(row.totalCost)}
                      </span>
                    </div>
                    {canWrite && (row.status === 'PLANNED' || row.status === 'SCHEDULED') ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          startService(row.id)
                            .then(() => client.invalidateQueries({ queryKey: ['services'] }))
                            .catch((error) => toast.error(errorMessage(error)))
                        }
                      >
                        {t('services.start')}
                      </Button>
                    ) : null}
                    {canWrite && row.status === 'IN_PROGRESS' ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            completeService(row.id)
                              .then(() => client.invalidateQueries({ queryKey: ['services'] }))
                              .catch((error) => toast.error(errorMessage(error)))
                          }
                        >
                          {t('services.complete')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            cancelService(row.id)
                              .then(() => client.invalidateQueries({ queryKey: ['services'] }))
                              .catch((error) => toast.error(errorMessage(error)))
                          }
                        >
                          {t('services.cancel')}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                )
              })}
          {query.isSuccess && rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t('services.emptyHint')}</li>
          ) : null}
        </ul>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('services.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('services.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!machineId) {
                setFormError(t('common.required'))
                return
              }
              setFormError('')
              try {
                await createService({ machineId })
                setMachineId('')
                setOpen(false)
                await client.invalidateQueries({ queryKey: ['services'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('services.machine')} htmlFor="service-machine" error={formError}>
              <select
                id="service-machine"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                value={machineId}
                onChange={(event) => setMachineId(event.target.value)}
              >
                <option value="">{t('services.selectMachine')}</option>
                {(machines.data ?? []).map((machine) => (
                  <option key={machine.id} value={machine.id}>
                    {machine.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
