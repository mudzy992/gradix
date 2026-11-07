import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createQuantity, listQuantities, patchQuantity } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useHasPermission } from '@/hooks/use-me'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const UNITS = ['M3', 'T', 'M', 'M2', 'PCS', 'H'] as const

export function QuantitiesTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const canWrite = useHasPermission('quantities.write')
  const roles = useAuthStore((state) => state.user?.roles ?? [])
  const canPlanned = roles.some((role) =>
    ['ADMIN', 'SUPER_ADMIN', 'PLATFORM_ADMIN', 'PROJECT_MANAGER'].includes(role),
  )
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['quantities', projectId],
    queryFn: async () => (await listQuantities(projectId)).data,
  })
  const [name, setName] = useState('')
  const [planned, setPlanned] = useState('')
  const [unit, setUnit] = useState<(typeof UNITS)[number]>('M3')
  const [saving, setSaving] = useState(false)
  const draft = name !== '' || planned !== '' || unit !== 'M3'
  useCompanySwitchBlock((canWrite && canPlanned && draft) || saving)
  const fieldId = useId()
  return (
    <div className="grid gap-3">
      {query.isLoading ? <p role="status">{t('common.loading')}</p> : null}
      {query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <span>{t('projects.quantitiesLoadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('dashboard.retry')}</Button>
        </div>
      ) : null}
      <Table label={t('projects.quantities')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('projects.name')}</TableHead>
            <TableHead>{t('projects.planned')}</TableHead>
            <TableHead>{t('projects.executed')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(query.data ?? []).map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name} ({t(`status.unit.${row.unit}`, { defaultValue: row.unit })})</TableCell>
              <TableCell>{row.plannedQty}</TableCell>
              <TableCell>
                {canWrite ? (
                  <Input
                    defaultValue={row.executedQty}
                    className="h-8 w-24"
                    aria-label={t('projects.executedFor', { name: row.name })}
                    onBlur={async (event) => {
                      const input = event.currentTarget
                      const next = input.value
                      if (next === row.executedQty) return
                      try {
                        await patchQuantity(projectId, row.id, { executedQty: next })
                        await client.invalidateQueries({ queryKey: ['quantities', projectId] })
                      } catch (error) {
                        // Do not display an uncommitted value as though it was saved.
                        if (input.value === next) input.value = row.executedQty
                        toast.error(errorMessage(error))
                      }
                    }}
                  />
                ) : (
                  row.executedQty
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canWrite && canPlanned ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            if (saving) return
            setSaving(true)
            try {
              await createQuantity(projectId, { name, unit, plannedQty: planned })
              setName('')
              setPlanned('')
              setUnit('M3')
              await client.invalidateQueries({ queryKey: ['quantities', projectId] })
            } catch (error) {
              toast.error(errorMessage(error))
            } finally {
              setSaving(false)
            }
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-name`}>{t('projects.name')}</Label>
            <Input id={`${fieldId}-name`} className="max-w-40" disabled={saving} value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-planned`}>{t('projects.planned')}</Label>
            <Input id={`${fieldId}-planned`} className="max-w-28" disabled={saving} value={planned} onChange={(event) => setPlanned(event.target.value)} required inputMode="decimal" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${fieldId}-unit`}>{t('projects.unit')}</Label>
            <select id={`${fieldId}-unit`} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" disabled={saving} value={unit} onChange={(event) => setUnit(event.target.value as (typeof UNITS)[number])}>
              {UNITS.map((item) => <option key={item} value={item}>{t(`status.unit.${item}`)}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={saving}>{t('common.save')}</Button>
          {draft ? <Button type="button" variant="outline" disabled={saving} onClick={() => { setName(''); setPlanned(''); setUnit('M3') }}>{t('common.discardDraft')}</Button> : null}
        </form>
      ) : null}
    </div>
  )
}
