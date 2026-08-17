import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listUsers, patchUser, resetUserPassword } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { displayName } from '@/lib/roles'
import { ROLES, type AppRole } from '@/lib/constants'
import type { ListUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { UserSheet } from '@/components/users/user-sheet'
import { TempPasswordDialog } from '@/components/users/temp-password-dialog'

export function UsersPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const me = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [role, setRole] = useState<AppRole | 'all'>('all')
  const [editing, setEditing] = useState<ListUser | null | undefined>(undefined)
  const [temp, setTemp] = useState<string | null>(null)
  const [deactivate, setDeactivate] = useState<ListUser | null>(null)
  const query = useQuery({
    queryKey: ['users', { page, q, role }],
    queryFn: async () =>
      listUsers({ page, q: q || undefined, role: role === 'all' ? undefined : role, limit: 20 }),
    enabled: tenantReady,
  })
  const disable = useMutation({
    mutationFn: (id: string) => patchUser(id, { isActive: false }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeactivate(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const reset = useMutation({
    mutationFn: resetUserPassword,
    onSuccess: (result) => setTemp(result.data.temporaryPassword),
    onError: (error) => toast.error(errorMessage(error)),
  })
  if (!tenantReady) {
    return (
      <div className="grid gap-3">
        <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
        <p className="text-muted-foreground">{t('users.needCompany')}</p>
      </div>
    )
  }
  const rows = query.data?.data ?? []
  const total = query.data?.meta?.total ?? 0
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('users.title')}</h1>
        <Button onClick={() => setEditing(null)}>{t('users.create')}</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder={t('users.search')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value)
            setPage(1)
          }}
        />
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value as AppRole | 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-48" aria-label={t('users.filterRole')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('users.allRoles')}</SelectItem>
            {ROLES.map((item) => (
              <SelectItem key={item} value={item}>
                {t(`roles.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('users.firstName')}</TableHead>
            <TableHead>{t('auth.email')}</TableHead>
            <TableHead>{t('users.roles')}</TableHead>
            <TableHead>{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{displayName(row)}</TableCell>
              <TableCell>{row.email}</TableCell>
              <TableCell className="flex flex-wrap gap-1">
                {row.roles.map((item) => (
                  <Badge key={item} variant="secondary">{t(`roles.${item}`)}</Badge>
                ))}
              </TableCell>
              <TableCell className="space-x-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                  {t('users.edit')}
                </Button>
                {me?.id !== row.id ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => reset.mutate(row.id)}>
                      {t('users.resetPassword')}
                    </Button>
                    {row.isActive ? (
                      <Button size="sm" variant="destructive" onClick={() => setDeactivate(row)}>
                        {t('users.deactivate')}
                      </Button>
                    ) : null}
                  </>
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
      <UserSheet
        user={editing ?? null}
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        onCreated={(password) => {
          setTemp(password)
          void queryClient.invalidateQueries({ queryKey: ['users'] })
        }}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ['users'] })}
      />
      <TempPasswordDialog password={temp} onClose={() => setTemp(null)} />
      <AlertDialog open={Boolean(deactivate)} onOpenChange={(open) => !open && setDeactivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.deactivate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('users.deactivateConfirm', { name: deactivate ? displayName(deactivate) : '' })}
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
