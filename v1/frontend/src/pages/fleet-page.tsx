import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { assignMachine, createMachine, listMachines, unassignMachine } from '@/lib/api-fleet'
import { listProjects } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { formatHours, machineStatus, machineType } from '@/lib/labels'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/**
 * FE-09 — flota. Do ovog segmenta tabela je prikazivala **sirove** enume (`EXCAVATOR`, `IN_SERVICE`),
 * sve badge-ove istog tona, sate kao `Decimal` string (`1234.500`) i nije imala stanja
 * (učitavanje/greška/prazno). Sada sve ide kroz `lib/labels.ts` (D-046), a tabela ima `caption`,
 * skeleton i trajnu grešku sa ponovnim pokušajem.
 */
const TYPES = ['TRUCK', 'EXCAVATOR', 'LOADER', 'GRADER', 'ROLLER', 'PAVER', 'DUMPER', 'COMPRESSOR', 'OTHER']

export function FleetPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const canWrite = useHasPermission('fleet.write')
  const canMap = useHasPermission('fleet.map')
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['machines'],
    queryFn: async () => listMachines({ limit: 100 }),
    enabled: tenantReady,
  })
  const projects = useQuery({
    queryKey: ['projects', { limit: 100 }],
    queryFn: async () => (await listProjects({ limit: 100 })).data,
    // Spisak projekata treba samo onome koji smije dodijeliti mašinu.
    enabled: tenantReady && canWrite,
  })
  const form = useForm({ defaultValues: { name: '', code: '', type: 'TRUCK' } })
  const rows = query.data?.data ?? []
  const projectOptions = projects.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('fleet.title')}</h1>
        <div className="flex gap-2">
          {canMap ? (
            <Button variant="outline" asChild>
              <Link to="/fleet/map">{t('fleet.map')}</Link>
            </Button>
          ) : null}
          {canWrite ? <Button onClick={() => setOpen(true)}>{t('fleet.create')}</Button> : null}
        </div>
      </div>

      <div aria-busy={query.isLoading}>
        <Table label={t('fleet.title')}>
          <TableCaption className="text-left text-sm text-muted-foreground">
            {query.isSuccess ? (rows.length > 0 ? t('fleet.count', { count: rows.length }) : t('fleet.empty')) : null}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('projects.name')}</TableHead>
              <TableHead>{t('fleet.type')}</TableHead>
              <TableHead>{t('projects.status')}</TableHead>
              <TableHead>{t('fleet.hours')}</TableHead>
              <TableHead>{t('common.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading
              ? [0, 1, 2].map((index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={5}>
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => {
                  const status = machineStatus(row.status)
                  const type = machineType(row.type)
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <span className="font-medium">{row.name}</span>
                        {row.code ? <span className="ml-2 text-xs text-muted-foreground">{row.code}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={type.tone}>{t(type.labelKey, { defaultValue: row.type })}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.tone}>{t(status.labelKey, { defaultValue: row.status })}</Badge>
                      </TableCell>
                      <TableCell>{formatHours(row.currentWorkingHours)}</TableCell>
                      <TableCell>
                        {canWrite && row.status !== 'DECOMMISSIONED' ? (
                          row.status === 'ACTIVE' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                unassignMachine(row.id)
                                  .then(() => client.invalidateQueries({ queryKey: ['machines'] }))
                                  .catch((error) => toast.error(errorMessage(error)))
                              }
                            >
                              {t('fleet.unassign')}
                            </Button>
                          ) : (
                            <select
                              // FE-09: bez imena ovaj `select` je za čitač ekrana bio „kombi bez labele“.
                              aria-label={t('fleet.assignLabel', { name: row.name })}
                              className="h-8 rounded-md border px-2 text-xs"
                              defaultValue=""
                              disabled={projectOptions.length === 0}
                              onChange={async (event) => {
                                if (!event.target.value) return
                                try {
                                  await assignMachine(row.id, { projectId: event.target.value })
                                  await client.invalidateQueries({ queryKey: ['machines'] })
                                } catch (error) {
                                  toast.error(errorMessage(error))
                                }
                                event.target.value = ''
                              }}
                            >
                              <option value="">
                                {projectOptions.length === 0 ? t('fleet.noProjects') : t('fleet.assign')}
                              </option>
                              {projectOptions.map((project) => (
                                <option key={project.id} value={project.id}>
                                  {project.name}
                                </option>
                              ))}
                            </select>
                          )
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
            {query.isSuccess && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  {t('fleet.emptyHint')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      {query.isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{t('fleet.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('dashboard.retry')}
          </Button>
        </div>
      ) : null}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('fleet.create')}</SheetTitle>
          </SheetHeader>
          <form
            className="grid gap-3 p-4"
            onSubmit={form.handleSubmit(async (values) => {
              try {
                await createMachine(values)
                await client.invalidateQueries({ queryKey: ['machines'] })
                setOpen(false)
                form.reset()
              } catch (error) {
                toast.error(errorMessage(error))
              }
            })}
          >
            <Field label={t('projects.name')} htmlFor="mname">
              <Input id="mname" {...form.register('name', { required: true })} />
            </Field>
            <Field label={t('projects.code')} htmlFor="mcode">
              <Input id="mcode" {...form.register('code')} />
            </Field>
            <Field label={t('fleet.type')} htmlFor="mtype">
              <select id="mtype" className="h-9 rounded-md border px-2 text-sm" {...form.register('type')}>
                {TYPES.map((item) => {
                  const type = machineType(item)
                  return (
                    <option key={item} value={item}>
                      {t(type.labelKey, { defaultValue: item })}
                    </option>
                  )
                })}
              </select>
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
