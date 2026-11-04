import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createDepot, createMaterial, listDepots, listMaterials, listTrips } from '@/lib/api-fleet'
import { downloadCsv } from '@/lib/csv'
import { errorMessage } from '@/lib/error-message'
import { materialUnit, tripStatusOf } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * FE-09 — logistika. Nalazi: kolona „Status“ je pod zaglavljem `projects.status` prikazivala
 * **sirove engleske riječi** `LOADED`/`UNLOADED`, količina nije imala jedinicu, liste materijala i
 * deponija nijedno stanje, a polja za dodavanje samo `placeholder` (nije labela, WCAG 3.3.2).
 */
export function LogisticsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWriteTrips = useHasPermission('trips.write')
  const canWriteSettings = useHasPermission('settings.write')
  const canWrite = canWriteTrips || canWriteSettings
  const client = useQueryClient()
  const [material, setMaterial] = useState('')
  const [materialUnitValue, setMaterialUnitValue] = useState('T')
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
  const materialRows = materials.data ?? []
  const depotRows = depots.data ?? []
  const UNITS = ['M3', 'T', 'M', 'M2', 'PCS', 'H', 'L']
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('logistics.title')}</h1>
        <Button
          variant="outline"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(t('logistics.csvName'), [
              [t('logistics.origin'), t('logistics.quantity'), t('projects.status')],
              ...rows.map((row) => {
                const status = tripStatusOf(row)
                return [row.originText, row.quantity, t(status.labelKey, { defaultValue: status.labelKey })]
              }),
            ])
          }
        >
          {t('logistics.csv')}
        </Button>
      </div>

      <div aria-busy={trips.isLoading}>
        <Table label={t('logistics.title')}>
          <TableCaption className="text-left text-sm text-muted-foreground">
            {trips.isSuccess ? (rows.length > 0 ? t('logistics.count', { count: rows.length }) : t('logistics.empty')) : null}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('logistics.origin')}</TableHead>
              <TableHead>{t('logistics.quantity')}</TableHead>
              <TableHead>{t('projects.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trips.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={3}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const status = tripStatusOf(row)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.originText}</TableCell>
                      <TableCell>{row.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={status.tone}>{t(status.labelKey, { defaultValue: row.unloadedAt ? 'UNLOADED' : 'LOADED' })}</Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
            {trips.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-sm text-muted-foreground">
                  {t('logistics.emptyHint')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {trips.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('logistics.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void trips.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="logistics-materials" className="grid gap-2">
        <h2 id="logistics-materials" className="text-lg font-medium">
          {t('logistics.materials')}
        </h2>
        {materialRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logistics.materialsEmpty')}</p>
        ) : (
          <ul className="text-sm">
            {materialRows.map((row) => {
              const unit = materialUnit(row.unit ?? '')
              return (
                <li key={row.id}>
                  {row.name} · {t(unit.labelKey, { defaultValue: row.unit ?? '' })}
                </li>
              )
            })}
          </ul>
        )}
        {canWrite ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault()
              try {
                await createMaterial({ name: material, unit: materialUnitValue })
                setMaterial('')
                await client.invalidateQueries({ queryKey: ['materials'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="material-name">
                {t('logistics.materialLabel')}
              </label>
              <Input
                id="material-name"
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                placeholder={t('logistics.addMaterial')}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="material-unit">
                {t('logistics.unitLabel')}
              </label>
              <select
                id="material-unit"
                className="h-9 rounded-md border px-2 text-sm"
                value={materialUnitValue}
                onChange={(event) => setMaterialUnitValue(event.target.value)}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {t(materialUnit(unit).labelKey, { defaultValue: unit })}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="logistics-depots" className="grid gap-2">
        <h2 id="logistics-depots" className="text-lg font-medium">
          {t('logistics.depots')}
        </h2>
        {depotRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('logistics.depotsEmpty')}</p>
        ) : (
          <ul className="text-sm">
            {depotRows.map((row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <form
            className="flex flex-wrap items-end gap-2"
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
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="depot-name">
                {t('logistics.depotLabel')}
              </label>
              <Input
                id="depot-name"
                value={depot}
                onChange={(event) => setDepot(event.target.value)}
                placeholder={t('logistics.addDepot')}
              />
            </div>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        ) : null}
      </section>
    </div>
  )
}
