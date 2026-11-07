import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createIncident, listIncidents, listProjects, patchIncident } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { hseSeverity, hseStatus } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * FE-10 — HSE prijave. Nalazi: ozbiljnost i status su bili **sirovi enumi** (`LOW`, `OPEN`, `ACK`)
 * sa badge-om bez značenja, dugmad „Potvrdi“/„Zatvori“ su bila vidljiva i onome bez `hse.write`,
 * a lista nije imala stanja (učitavanje/greška/prazno) niti broj prijava. Status `ACK` se zvao
 * „Potvrdi“ i na dugmetu i u podatku — sada je „Potvrđena“.
 *
 * Napomena (D-033): prijavljivač bez `hse.read` dobija **samo svoje** prijave sa backenda; ekran je
 * isti, pa nema posebne grane „vidiš samo svoje“.
 */
export function HsePage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('hse.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('LOW')
  const [projectId, setProjectId] = useState('')
  const [formError, setFormError] = useState('')
  const query = useQuery({
    queryKey: ['incidents'],
    queryFn: async () => listIncidents({ limit: 50 }),
    enabled: tenantReady,
  })
  const projects = useQuery({
    queryKey: ['projects', { limit: 100 }],
    queryFn: async () => (await listProjects({ limit: 100 })).data,
    enabled: open,
  })
  const rows = query.data?.data ?? []
  const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH']
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('hse.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('hse.create')}</Button> : null}
      </div>

      <div aria-busy={query.isLoading}>
        {query.isSuccess ? (
          <p className="text-sm text-muted-foreground">
            {rows.length > 0 ? t('hse.count', { count: rows.length }) : t('hse.empty')}
          </p>
        ) : null}
        <ul aria-label={t('hse.list')} className="mt-2 grid gap-2">
          {query.isLoading
            ? [0, 1, 2].map((index) => (
                <li key={`skeleton-${index}`}>
                  <div className="h-12 w-full animate-pulse rounded-md bg-muted" />
                </li>
              ))
            : rows.map((row) => {
                const severityMeta = hseSeverity(row.severity)
                const statusMeta = hseStatus(row.status)
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={severityMeta.tone}>
                          {t(severityMeta.labelKey, { defaultValue: row.severity })}
                        </Badge>
                        <span>{row.description}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('hse.date')}: {row.createdAt.slice(0, 10)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusMeta.tone}>
                        {t(statusMeta.labelKey, { defaultValue: row.status })}
                      </Badge>
                      {/* FE-10: akcije su išle svima koji vide listu — sada samo uz `hse.write`. */}
                      {canWrite && row.status === 'OPEN' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            patchIncident(row.id, 'ACK')
                              .then(() => client.invalidateQueries({ queryKey: ['incidents'] }))
                              .catch((error) => toast.error(errorMessage(error)))
                          }
                        >
                          {t('hse.ack')}
                        </Button>
                      ) : null}
                      {canWrite && row.status !== 'CLOSED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            patchIncident(row.id, 'CLOSED')
                              .then(() => client.invalidateQueries({ queryKey: ['incidents'] }))
                              .catch((error) => toast.error(errorMessage(error)))
                          }
                        >
                          {t('hse.close')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
          {query.isSuccess && rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t('hse.emptyHint')}</li>
          ) : null}
        </ul>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('hse.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('hse.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!description.trim()) {
                setFormError(t('common.required'))
                return
              }
              setFormError('')
              try {
                await createIncident({ description, severity, projectId: projectId || undefined })
                setDescription('')
                setOpen(false)
                await client.invalidateQueries({ queryKey: ['incidents'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('hse.project')} htmlFor="hse-project">
              <select
                id="hse-project"
                className="h-9 rounded-md border px-2 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="" />
                {(projects.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('hse.severity')} htmlFor="hse-severity">
              <select
                id="hse-severity"
                className="h-9 rounded-md border px-2 text-sm"
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
              >
                {SEVERITIES.map((item) => {
                  const meta = hseSeverity(item)
                  return (
                    <option key={item} value={item}>
                      {t(meta.labelKey, { defaultValue: item })}
                    </option>
                  )
                })}
              </select>
            </Field>
            <Field label={t('hse.description')} htmlFor="hse-description" error={formError}>
              <Textarea
                id="hse-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <SheetFooter>
              <Button type="submit">{t('common.save')}</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
