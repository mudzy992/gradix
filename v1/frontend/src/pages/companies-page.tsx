import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listCompanies, patchCompanyPlatform } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { accountStatus } from '@/lib/labels'
import type { CompanyRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

/**
 * FE-13 — firme (platform admin). Nalazi: kolona statusa je imala **prazno zaglavlje**, tabela nije
 * imala `caption`, nije bilo greške/skeletona/praznog stanja, a deaktivirana firma se **nije mogla**
 * vratiti u pogon iako API prima `isActive: true`; ishod deaktivacije nije bio potvrđen nikakvom
 * porukom.
 */
export function CompaniesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<CompanyRow | null | undefined>(undefined)
  const [temp, setTemp] = useState<string | null>(null)
  const [deactivate, setDeactivate] = useState<CompanyRow | null>(null)
  const [activate, setActivate] = useState<CompanyRow | null>(null)
  const query = useQuery({
    queryKey: ['companies', { page }],
    queryFn: async () => listCompanies({ page, limit: 20 }),
  })
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['companies'] })
  }
  const disable = useMutation({
    mutationFn: (id: string) => patchCompanyPlatform(id, { isActive: false }),
    onSuccess: () => {
      toast.success(t('companies.deactivated'))
      refresh()
      setDeactivate(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const enable = useMutation({
    mutationFn: (id: string) => patchCompanyPlatform(id, { isActive: true }),
    onSuccess: () => {
      toast.success(t('companies.activated'))
      refresh()
      setActivate(null)
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

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('companies.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <div aria-busy={query.isLoading}>
        <Table label={t('companies.title')}>
          <TableCaption>
            {query.isSuccess ? t('companies.caption', { count: total }) : t('companies.title')}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.name')}</TableHead>
              <TableHead>{t('settings.slug')}</TableHead>
              <TableHead>{t('companies.status')}</TableHead>
              <TableHead>{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`companies-skeleton-${index}`}>
                    <TableCell colSpan={4}>
                      <div className="h-6 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const status = accountStatus(row.isActive)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.slug}</TableCell>
                      <TableCell>
                        <Badge variant={status.tone}>{t(status.labelKey, { defaultValue: String(row.isActive) })}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                          {t('companies.edit')}
                        </Button>
                        {row.isActive ? (
                          <Button size="sm" variant="destructive" onClick={() => setDeactivate(row)}>
                            {t('companies.deactivate')}
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => setActivate(row)}>
                            {t('companies.activate')}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
            {query.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  {t('companies.empty')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {query.isSuccess ? <p className="text-sm text-muted-foreground">{t('companies.count', { count: total })}</p> : null}

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
          refresh()
        }}
        onSaved={refresh}
      />
      <TempPasswordDialog password={temp} onClose={() => setTemp(null)} />

      <AlertDialog open={Boolean(deactivate)} onOpenChange={(open) => !open && setDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('companies.deactivate')}</AlertDialogTitle>
            <AlertDialogDescription>{t('companies.deactivateConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivate && disable.mutate(deactivate.id)}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(activate)} onOpenChange={(open) => !open && setActivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('companies.activate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('companies.activateConfirm', { name: activate?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => activate && enable.mutate(activate.id)}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
