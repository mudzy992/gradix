import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createIncident, listIncidents, listProjects, patchIncident } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export function HsePage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('hse.write')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('LOW')
  const [projectId, setProjectId] = useState('')
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
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('hse.title')}</h1>
        {canWrite ? <Button onClick={() => setOpen(true)}>{t('hse.create')}</Button> : null}
      </div>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <div>
              <Badge variant="secondary">{row.severity}</Badge>
              <span className="ml-2">{row.description}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{row.status}</Badge>
              {row.status === 'OPEN' ? (
                <Button size="sm" variant="outline" onClick={() => patchIncident(row.id, 'ACK').then(() => client.invalidateQueries({ queryKey: ['incidents'] })).catch((error) => toast.error(errorMessage(error)))}>
                  {t('hse.ack')}
                </Button>
              ) : null}
              {row.status !== 'CLOSED' ? (
                <Button size="sm" variant="outline" onClick={() => patchIncident(row.id, 'CLOSED').then(() => client.invalidateQueries({ queryKey: ['incidents'] })).catch((error) => toast.error(errorMessage(error)))}>
                  {t('hse.close')}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('hse.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={async (event) => {
              event.preventDefault()
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
            <Field label={t('projects.title')}>
              <select className="h-9 rounded-md border px-2 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="" />
                {(projects.data ?? []).map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </Field>
            <Field label={t('hse.severity')}>
              <select className="h-9 rounded-md border px-2 text-sm" value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </Field>
            <Field label={t('hse.description')}>
              <Textarea value={description} onChange={(event) => setDescription(event.target.value)} required />
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
