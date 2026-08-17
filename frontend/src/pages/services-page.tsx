import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cancelService, completeService, createService, listServices, startService } from '@/lib/api-polish'
import { listMachines } from '@/lib/api-fleet'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export function ServicesPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('services.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [machineId, setMachineId] = useState('')
  const query = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await listServices({ limit: 50 })).data,
    enabled: tenantReady,
  })
  const machines = useQuery({
    queryKey: ['machines', { limit: 100 }],
    queryFn: async () => (await listMachines({ limit: 100 })).data,
    enabled: open,
  })
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('services.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('services.create')}</Button> : null}
      </div>
      <ul className="grid gap-2">
        {(query.data ?? []).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div>
              <Badge variant="secondary">{row.status}</Badge>
              <span className="ml-2">{row.machineId}</span>
            </div>
            {canWrite && (row.status === 'PLANNED' || row.status === 'SCHEDULED') ? (
              <Button size="sm" onClick={() => startService(row.id).then(() => client.invalidateQueries({ queryKey: ['services'] })).catch((error) => toast.error(errorMessage(error)))}>
                {t('services.start')}
              </Button>
            ) : null}
            {canWrite && row.status === 'IN_PROGRESS' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => completeService(row.id).then(() => client.invalidateQueries({ queryKey: ['services'] })).catch((error) => toast.error(errorMessage(error)))}>
                  {t('services.complete')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => cancelService(row.id).then(() => client.invalidateQueries({ queryKey: ['services'] })).catch((error) => toast.error(errorMessage(error)))}>
                  {t('services.cancel')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('services.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await createService({ machineId })
                setOpen(false)
                await client.invalidateQueries({ queryKey: ['services'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('services.machine')}>
              <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={machineId} onChange={(event) => setMachineId(event.target.value)} required>
                <option value="" />
                {(machines.data ?? []).map((machine) => (
                  <option key={machine.id} value={machine.id}>{machine.name}</option>
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
