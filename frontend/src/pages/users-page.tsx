import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listUsers, patchUser, resetUserPassword } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { accountStatus } from '@/lib/labels'
import { displayName } from '@/lib/roles'
import { ROLES, type AppRole } from '@/lib/constants'
import type { ListUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

/**
 * FE-13 — korisnici. Nalazi: tabela **nije imala status**, pa se deaktiviran korisnik nije razlikovao
 * od aktivnog, a reaktivacije nije bilo nigdje (iako API prima `isActive: true`) — deaktivacija je
 * bila trajna iz UI-a. Reset lozinke je išao **jednim klikom** (obara tuđu sesiju bez pitanja), nije
 * bilo greške, skeletona ni praznog stanja (pad liste = prazna tabela), pretraga je imala samo
 * `placeholder`, a tabela nije imala `caption` ni broj.
 */
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
  const [activate, setActivate] = useState<ListUser | null>(null)
  const [resetTarget, setResetTarget] = useState<ListUser | null>(null)
  // A synchronous latch closes the gap before React Query renders isPending.
  const resetInFlight = useRef(false)
  const query = useQuery({
    queryKey: ['users', { page, q, role }],
    queryFn: async () => listUsers({ page, q: q || undefined, role: role === 'all' ? undefined : role, limit: 20 }),
    enabled: tenantReady,
  })
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] })
  }
  const disable = useMutation({
    mutationFn: (id: string) => patchUser(id, { isActive: false }),
    onSuccess: () => {
      toast.success(t('users.deactivated'))
      refresh()
      setDeactivate(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const enable = useMutation({
    mutationFn: (id: string) => patchUser(id, { isActive: true }),
    onSuccess: () => {
      toast.success(t('users.activated'))
      refresh()
      setActivate(null)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const reset = useMutation({
    mutationFn: resetUserPassword,
    onSuccess: (result) => {
      setResetTarget(null)
      setTemp(result.data.temporaryPassword)
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => { resetInFlight.current = false },
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
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('users.searchLabel')} htmlFor="users-search">
          <Input
            id="users-search"
            className="max-w-xs"
            placeholder={t('users.search')}
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
          />
        </Field>
        <Field label={t('users.filterRole')} htmlFor="users-role">
          <Select
            value={role}
            onValueChange={(value) => {
              setRole(value as AppRole | 'all')
              setPage(1)
            }}
          >
            <SelectTrigger id="users-role" className="w-48">
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
        </Field>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('users.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <div aria-busy={query.isLoading}>
        <Table label={t('users.title')}>
          <TableCaption>
            {query.isSuccess ? t('users.caption', { count: total }) : t('users.title')}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.firstName')}</TableHead>
              <TableHead>{t('auth.email')}</TableHead>
              <TableHead>{t('users.roles')}</TableHead>
              <TableHead>{t('users.status')}</TableHead>
              <TableHead>{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`users-skeleton-${index}`}>
                    <TableCell colSpan={5}>
                      <div className="h-6 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const status = accountStatus(row.isActive)
                  const isMe = me?.id === row.id
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span>{displayName(row)}</span>
                        {isMe ? (
                          <span className="ml-2 text-xs text-muted-foreground">({t('users.you')})</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap gap-1">
                          {row.roles.map((item) => (
                            <Badge key={item} variant="secondary">
                              {t(`roles.${item}`)}
                            </Badge>
                          ))}
                        </span>
                      </TableCell>
                      {/* FE-13: status je ranije bio samo boja badge-a u koloni bez zaglavlja. */}
                      <TableCell>
                        <Badge variant={status.tone}>{t(status.labelKey, { defaultValue: String(row.isActive) })}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
                          {t('users.edit')}
                        </Button>
                        {isMe ? null : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => { reset.reset(); setResetTarget(row) }}>
                              {t('users.resetPassword')}
                            </Button>
                            {row.isActive ? (
                              <Button size="sm" variant="destructive" onClick={() => setDeactivate(row)}>
                                {t('users.deactivate')}
                              </Button>
                            ) : (
                              <Button size="sm" onClick={() => setActivate(row)}>
                                {t('users.activate')}
                              </Button>
                            )}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
            {query.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  {t('users.empty')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {query.isSuccess ? (
        <p className="text-sm text-muted-foreground">{t('users.count', { count: total })}</p>
      ) : null}

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
          refresh()
        }}
        onSaved={refresh}
      />
      <TempPasswordDialog password={temp} onClose={() => setTemp(null)} />

      <AlertDialog open={Boolean(resetTarget)} onOpenChange={(open) => { if (!open && !resetInFlight.current) setResetTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.resetPassword')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('users.resetConfirm', { name: resetTarget ? displayName(resetTarget) : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reset.isPending ? <p role="status" className="text-sm">{t('users.resetPending')}</p> : null}
          {reset.isError ? <p role="alert" className="text-sm text-destructive">{t('users.resetUnknown')}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reset.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={reset.isPending || reset.isError} onClick={(event) => {
              // Radix actions close by default; keep the old company locked until
              // the response has either been displayed or explicitly dismissed.
              event.preventDefault()
              if (!resetTarget || resetInFlight.current || reset.isError) return
              resetInFlight.current = true
              reset.mutate(resetTarget.id)
            }}>
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={Boolean(activate)} onOpenChange={(open) => !open && setActivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('users.activate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('users.activateConfirm', { name: activate ? displayName(activate) : '' })}
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
