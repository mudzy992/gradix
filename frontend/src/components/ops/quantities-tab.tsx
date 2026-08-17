import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createQuantity, listQuantities, patchQuantity } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  return (
    <div className="grid gap-3">
      <Table>
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
              <TableCell>{row.name} ({row.unit})</TableCell>
              <TableCell>{row.plannedQty}</TableCell>
              <TableCell>
                {canWrite ? (
                  <Input
                    defaultValue={row.executedQty}
                    className="h-8 w-24"
                    onBlur={async (event) => {
                      try {
                        await patchQuantity(projectId, row.id, { executedQty: event.target.value })
                        await client.invalidateQueries({ queryKey: ['quantities', projectId] })
                      } catch (error) {
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
            try {
              await createQuantity(projectId, { name, unit: UNITS[0], plannedQty: planned })
              setName('')
              setPlanned('')
              await client.invalidateQueries({ queryKey: ['quantities', projectId] })
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Input className="max-w-40" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('projects.name')} />
          <Input className="max-w-28" value={planned} onChange={(event) => setPlanned(event.target.value)} placeholder={t('projects.planned')} />
          <Button type="submit">{t('common.save')}</Button>
        </form>
      ) : null}
    </div>
  )
}
