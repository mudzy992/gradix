import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listCompanies, patchCompanyPlatform } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import type { CompanyRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CompanySheet } from '@/components/companies/company-sheet'
import { TempPasswordDialog } from '@/components/users/temp-password-dialog'

export function CompaniesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<CompanyRow | null | undefined>(undefined)
  const [temp, setTemp] = useState<string | null>(null)
  const [deactivate, setDeactivate] = useState<CompanyRow | null>(null)
  const query = useQuery({
    queryKey: ['companies', { page }],
    queryFn: async () => listCompanies({ page, limit: 20 }),
  })
  const disable = useMutation({
    mutationFn: (id: string) => patchCompanyPlatform(id, { isActive: false }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['companies'] })
      setDeactivate(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const rows = query.data?.data ?? []
  const total = query.data?.meta?.total ?? 0
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('companies.title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('companies.create')}</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('settings.name')}</TableHead>
            <TableHead>{t('settings.slug')}</TableHead>
            <TableHead />
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.slug}</TableCell>
              <TableCell>
                <Badge variant={row.isActive ? 'secondary' : 'destructive'}>
                  {row.isActive ? t('users.active') : t('users.inactive')}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                  {t('companies.edit')}
                </Button>
                {row.isActive ? (
                  <Button size="sm" variant="destructive" onClick={() => setDeactivate(row)}>
                    {t('companies.deactivate')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          {t('common.prev')}
        </Button>
        <span className="text-sm">{t('common.page', { page })}</span>
        <Button variant="outline" disabled={page * 20 >= total} onClick={() => setPage((value) => value + 1)}>
          {t('common.next')}
        </Button>
      </div>
      <CompanySheet
        company={editing ?? null}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onCreated={(password) => {
          setTemp(password)
          void queryClient.invalidateQueries({ queryKey: ['companies'] })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['companies'] })}
      />
      <TempPasswordDialog password={temp} onClose={() => setTemp(null)} />
      <AlertDialog open={Boolean(deactivate)} onOpenChange={(open) => !open && setDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('companies.deactivate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('companies.deactivateConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivate && disable.mutate(deactivate.id)}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
