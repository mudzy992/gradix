import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createDoc, listDocs } from '@/lib/api-polish'
import { listMachines } from '@/lib/api-fleet'
import { listUsers, uploadFile } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { daysUntil, documentState } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Kind = 'company' | 'worker' | 'machine'

/**
 * FE-10 — dokumenti i rokovi. Nalazi: ekran je pisao „Upozorenja 30 / 15 / 5 dana“, a uz dokument je
 * stajao samo datum — korisnik je morao sam računati da li je istekao; nije bilo stanja liste
 * (učitavanje/greška/prazno), broja dokumenata ni labele na izboru fajla; forma nije govorila šta se
 * smije uploadovati, a izbor fajla je bio „skriveni“ uslov (`required` bez poruke).
 */
export function DocumentsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('documents.write')
  const client = useQueryClient()
  const [kind, setKind] = useState<Kind>('company')
  const [open, setOpen] = useState(false)
  const [docType, setDocType] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [userId, setUserId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [formError, setFormError] = useState('')
  const docs = useQuery({
    queryKey: ['compliance-docs', kind],
    queryFn: async () => (await listDocs(kind)).data,
    enabled: tenantReady,
  })
  const users = useQuery({
    queryKey: ['users', { limit: 100 }],
    queryFn: async () => (await listUsers({ limit: 100 })).data,
    enabled: open && kind === 'worker',
  })
  const machines = useQuery({
    queryKey: ['machines', { limit: 100 }],
    queryFn: async () => (await listMachines({ limit: 100 })).data,
    enabled: open && kind === 'machine',
  })
  const rows = docs.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('docs.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('docs.create')}</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('docs.warnHint')}</p>
      <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)}>
        <TabsList>
          <TabsTrigger value="company">{t('docs.company')}</TabsTrigger>
          <TabsTrigger value="worker">{t('docs.worker')}</TabsTrigger>
          <TabsTrigger value="machine">{t('docs.machine')}</TabsTrigger>
        </TabsList>
        <TabsContent value={kind}>
          <div aria-busy={docs.isLoading} className="grid gap-2">
            {docs.isSuccess ? (
              <p className="text-sm text-muted-foreground">
                {rows.length > 0 ? t('docs.count', { count: rows.length }) : t('docs.empty')}
              </p>
            ) : null}
            <ul aria-label={t('docs.list')} className="grid gap-2">
              {docs.isLoading
                ? [0, 1, 2].map((index) => (
                    <li key={`skeleton-${index}`}>
                      <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
                    </li>
                  ))
                : rows.map((row) => {
                    const state = documentState(row.expiresAt)
                    const days = daysUntil(row.expiresAt)
                    return (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                      >
                        <span>{row.type}</span>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground">
                            {t('docs.expires')}: {row.expiresAt?.slice(0, 10) ?? t('projects.dash')}
                          </span>
                          {/* FE-10: stanje roka umjesto da korisnik računa dane. */}
                          <Badge variant={state.tone}>{t(state.labelKey)}</Badge>
                          {days !== null && days >= 0 && days <= 30 ? (
                            <span className="text-xs text-muted-foreground">
                              {t('docs.expiresIn', { days })}
                            </span>
                          ) : null}
                          {days !== null && days < 0 ? (
                            <span className="text-xs text-destructive">
                              {t('docs.expiredAgo', { days: Math.abs(days) })}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
              {docs.isSuccess && rows.length === 0 ? (
                <li className="text-sm text-muted-foreground">{t('docs.emptyHint')}</li>
              ) : null}
            </ul>
          </div>

          {docs.isError ? (
            <div
              role="alert"
              className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <span>{t('docs.loadError')}</span>
              <Button size="sm" variant="outline" onClick={() => void docs.refetch()}>
                {t('dashboard.retry')}
              </Button>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('docs.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!file) {
                setFormError(t('common.required'))
                return
              }
              setFormError('')
              try {
                const uploaded = await uploadFile(file)
                await createDoc(kind, {
                  type: docType,
                  filePath: uploaded.data.path,
                  expiresAt: expiresAt || undefined,
                  userId: kind === 'worker' ? userId : undefined,
                  machineId: kind === 'machine' ? machineId : undefined,
                })
                setOpen(false)
                setDocType('')
                setFile(null)
                await client.invalidateQueries({ queryKey: ['compliance-docs'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('docs.type')} htmlFor="doc-type">
              <Input id="doc-type" value={docType} onChange={(event) => setDocType(event.target.value)} required />
            </Field>
            {kind === 'worker' ? (
              <Field label={t('docs.worker')} htmlFor="doc-worker">
                <select
                  id="doc-worker"
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                >
                  <option value="" />
                  {(users.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {kind === 'machine' ? (
              <Field label={t('docs.machine')} htmlFor="doc-machine">
                <select
                  id="doc-machine"
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={machineId}
                  onChange={(event) => setMachineId(event.target.value)}
                  required
                >
                  <option value="" />
                  {(machines.data ?? []).map((machine) => (
                    <option key={machine.id} value={machine.id}>
                      {machine.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={t('docs.expires')} htmlFor="doc-expires">
              <Input
                id="doc-expires"
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </Field>
            <Field
              label={t('docs.file')}
              htmlFor="doc-file"
              hint={t('docs.fileHint')}
              error={formError}
            >
              <Input id="doc-file" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
