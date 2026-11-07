import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { convertTender, createTender, listTenders, patchTender } from '@/lib/api-polish'
import { errorMessage } from '@/lib/error-message'
import { formatAmount, tenderStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const COLUMNS = ['DRAFT', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN'] as const

/**
 * FE-11 — tenderi. Nalazi: kolone su imale naslove (dobar dio), ali **bez broja i praznog stanja**,
 * nije bilo učitavanja ni greške; iznosi su se prikazivali kao „12000.00 vs 15230.50“ (tačka kao
 * decimalni znak, bez hiljada); dugme je pisalo „Označi WON“ (miješan jezik), a polja forme nisu bila
 * povezana sa labelama. Sada: broj po koloni, „nema tendera“ po koloni, skeleton, greška + retry,
 * `formatAmount`, prevedeno dugme i labele.
 */
export function TendersPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('tenders.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [value, setValue] = useState('')
  const [formError, setFormError] = useState('')
  const query = useQuery({
    queryKey: ['tenders'],
    queryFn: async () => (await listTenders({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const rows = query.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('tenders.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('tenders.create')}</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('tenders.compareHint')}</p>

      <div aria-busy={query.isLoading} className="grid gap-3 md:grid-cols-5">
        {COLUMNS.map((status) => {
          const meta = tenderStatus(status)
          const inColumn = rows.filter((row) => row.status === status)
          return (
            <section
              key={status}
              aria-labelledby={`tender-col-${status}`}
              className="rounded-md border p-3"
            >
              <h2 id={`tender-col-${status}`} className="mb-2 flex items-center justify-between gap-2 text-sm font-medium">
                <span>{t(meta.labelKey, { defaultValue: status })}</span>
                <Badge variant={meta.tone}>{inColumn.length}</Badge>
              </h2>
              <ul className="grid gap-2">
                {query.isLoading
                  ? [0, 1].map((index) => (
                      <li key={`skeleton-${index}`}>
                        <div className="h-16 w-full animate-pulse rounded-md bg-muted" />
                      </li>
                    ))
                  : inColumn.map((row) => (
                      <li key={row.id} className="rounded-md border bg-card p-2 text-sm">
                        <p className="font-medium">{row.title}</p>
                        <p className="text-muted-foreground">{row.client}</p>
                        {/* FE-11: iznosi su bili sirovi decimalni stringovi sa tačkom. */}
                        <p>
                          {formatAmount(row.submittedValue)} / {formatAmount(row.comparison)}
                        </p>
                        {canWrite && status === 'DRAFT' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() =>
                              patchTender(row.id, { status: 'SUBMITTED' })
                                .then(() => client.invalidateQueries({ queryKey: ['tenders'] }))
                                .catch((error) => toast.error(errorMessage(error)))
                            }
                          >
                            {t('tenders.submit')}
                          </Button>
                        ) : null}
                        {canWrite && status === 'SUBMITTED' ? (
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={() =>
                              patchTender(row.id, { status: 'WON' })
                                .then(() => client.invalidateQueries({ queryKey: ['tenders'] }))
                                .catch((error) => toast.error(errorMessage(error)))
                            }
                          >
                            {t('tenders.markWon')}
                          </Button>
                        ) : null}
                        {canWrite && status === 'WON' && !row.convertedProjectId ? (
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={() =>
                              convertTender(row.id)
                                .then(() => client.invalidateQueries({ queryKey: ['tenders'] }))
                                .catch((error) => toast.error(errorMessage(error)))
                            }
                          >
                            {t('tenders.convert')}
                          </Button>
                        ) : null}
                        {row.convertedProjectId ? (
                          <Badge variant="secondary" className="mt-2">
                            {t('tenders.converted')}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                {query.isSuccess && inColumn.length === 0 ? (
                  <li className="text-xs text-muted-foreground">{t('tenders.columnEmpty')}</li>
                ) : null}
              </ul>
            </section>
          )
        })}
      </div>

      {query.isSuccess ? (
        <p className="text-sm text-muted-foreground">{t('tenders.count', { count: rows.length })}</p>
      ) : null}

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('tenders.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('tenders.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!title.trim() || !clientName.trim()) {
                setFormError(t('common.required'))
                return
              }
              setFormError('')
              try {
                await createTender({ title, client: clientName, submittedValue: value || undefined })
                setTitle('')
                setClientName('')
                setValue('')
                setOpen(false)
                await client.invalidateQueries({ queryKey: ['tenders'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('tenders.name')} htmlFor="tender-title" error={formError}>
              <Input id="tender-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label={t('tenders.client')} htmlFor="tender-client">
              <Input id="tender-client" value={clientName} onChange={(event) => setClientName(event.target.value)} />
            </Field>
            <Field label={t('tenders.value')} htmlFor="tender-value">
              <Input
                id="tender-value"
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
