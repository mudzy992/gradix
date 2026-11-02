import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createDepot, createMaterial, listDepots, listMaterials, listTrips } from '@/lib/api-fleet'
import { downloadCsv } from '@/lib/csv'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function LogisticsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWriteTrips = useHasPermission('trips.write')
  const canWriteSettings = useHasPermission('settings.write')
  const canWrite = canWriteTrips || canWriteSettings
  const client = useQueryClient()
  const [material, setMaterial] = useState('')
  const [depot, setDepot] = useState('')
  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: async () => listTrips({ limit: 100 }),
    enabled: tenantReady,
  })
  const materials = useQuery({
    queryKey: ['materials'],
    queryFn: async () => (await listMaterials()).data,
    enabled: tenantReady,
  })
  const depots = useQuery({
    queryKey: ['depots'],
    queryFn: async () => (await listDepots()).data,
    enabled: tenantReady,
  })
  const rows = trips.data?.data ?? []
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('logistics.title')}</h1>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv('trips.csv', [
              ['id', 'projectId', 'quantity', 'origin', 'loadedAt'],
              ...rows.map((row) => [row.id, row.projectId, row.quantity, row.originText, row.loadedAt]),
            ])
          }
        >
          {t('logistics.csv')}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('logistics.origin')}</TableHead>
            <TableHead>{t('logistics.quantity')}</TableHead>
            <TableHead>{t('projects.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.originText}</TableCell>
              <TableCell>{row.quantity}</TableCell>
              <TableCell>{row.unloadedAt ? 'UNLOADED' : 'LOADED'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <section className="grid gap-2">
        <h2 className="text-lg font-medium">{t('logistics.materials')}</h2>
        <ul className="text-sm">{(materials.data ?? []).map((row) => <li key={row.id}>{row.name} · {row.unit}</li>)}</ul>
        {canWrite ? (
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await createMaterial({ name: material, unit: 'T' })
                setMaterial('')
                await client.invalidateQueries({ queryKey: ['materials'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Input value={material} onChange={(event) => setMaterial(event.target.value)} placeholder={t('logistics.addMaterial')} />
            <Button type="submit">{t('common.save')}</Button>
          </form>
        ) : null}
      </section>
      <section className="grid gap-2">
        <h2 className="text-lg font-medium">{t('logistics.depots')}</h2>
        <ul className="text-sm">{(depots.data ?? []).map((row) => <li key={row.id}>{row.name}</li>)}</ul>
        {canWrite ? (
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await createDepot({ name: depot })
                setDepot('')
                await client.invalidateQueries({ queryKey: ['depots'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Input value={depot} onChange={(event) => setDepot(event.target.value)} placeholder={t('logistics.addDepot')} />
            <Button type="submit">{t('common.save')}</Button>
          </form>
        ) : null}
      </section>
    </div>
  )
}
