import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { convertTender, createTender, listTenders, patchTender } from '@/lib/api-polish'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

const COLUMNS = ['DRAFT', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN'] as const

export function TendersPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('tenders.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [value, setValue] = useState('')
  const query = useQuery({
    queryKey: ['tenders'],
    queryFn: async () => (await listTenders({ limit: 100 })).data,
    enabled: tenantReady,
  })
  const rows = query.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('tenders.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('tenders.create')}</Button> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('tenders.compareHint')}</p>
      <div className="grid gap-3 md:grid-cols-5">
        {COLUMNS.map((status) => (
          <section key={status} className="rounded-md border p-3">
            <h2 className="mb-2 text-sm font-medium">{t(`tenders.status.${status}`)}</h2>
            <ul className="grid gap-2">
              {rows.filter((row) => row.status === status).map((row) => (
                <li key={row.id} className="rounded-md border bg-card p-2 text-sm">
                  <p className="font-medium">{row.title}</p>
                  <p className="text-muted-foreground">{row.client}</p>
                  <p>{row.submittedValue ?? t('projects.dash')} vs {row.comparison ?? t('projects.dash')}</p>
                  {canWrite && status === 'DRAFT' ? (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => patchTender(row.id, { status: 'SUBMITTED' }).then(() => client.invalidateQueries({ queryKey: ['tenders'] })).catch((error) => toast.error(errorMessage(error)))}>
                      {t('tenders.submit')}
                    </Button>
                  ) : null}
                  {canWrite && status === 'SUBMITTED' ? (
                    <Button size="sm" className="mt-2" onClick={() => patchTender(row.id, { status: 'WON' }).then(() => client.invalidateQueries({ queryKey: ['tenders'] })).catch((error) => toast.error(errorMessage(error)))}>
                      {t('tenders.markWon')}
                    </Button>
                  ) : null}
                  {canWrite && status === 'WON' && !row.convertedProjectId ? (
                    <Button size="sm" className="mt-2" onClick={() => convertTender(row.id).then(() => client.invalidateQueries({ queryKey: ['tenders'] })).catch((error) => toast.error(errorMessage(error)))}>
                      {t('tenders.convert')}
                    </Button>
                  ) : null}
                  {row.convertedProjectId ? <Badge variant="secondary">{t('tenders.converted')}</Badge> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('tenders.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
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
            <Field label={t('tenders.name')}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} required />
            </Field>
            <Field label={t('tenders.client')}>
              <Input value={clientName} onChange={(event) => setClientName(event.target.value)} required />
            </Field>
            <Field label={t('tenders.value')}>
              <Input value={value} onChange={(event) => setValue(event.target.value)} />
            </Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
