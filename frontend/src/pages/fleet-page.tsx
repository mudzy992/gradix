import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { assignMachine, createMachine, listMachines, unassignMachine } from '@/lib/api-fleet'
import { listProjects } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

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
    enabled: canWrite,
  })
  const form = useForm({ defaultValues: { name: '', code: '', type: 'TRUCK' } })
  const rows = query.data?.data ?? []
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('projects.name')}</TableHead>
            <TableHead>{t('fleet.type')}</TableHead>
            <TableHead>{t('projects.status')}</TableHead>
            <TableHead>{t('fleet.hours')}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.type}</TableCell>
              <TableCell><Badge variant="secondary">{row.status}</Badge></TableCell>
              <TableCell>{row.currentWorkingHours}</TableCell>
              <TableCell>
                {canWrite && row.status !== 'DECOMMISSIONED' ? (
                  row.status === 'ACTIVE' ? (
                    <Button size="sm" variant="outline" onClick={() => unassignMachine(row.id).then(() => client.invalidateQueries({ queryKey: ['machines'] })).catch((error) => toast.error(errorMessage(error)))}>
                      {t('fleet.unassign')}
                    </Button>
                  ) : (
                    <select
                      className="h-8 rounded-md border px-2 text-xs"
                      defaultValue=""
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
                      <option value="">{t('fleet.assign')}</option>
                      {(projects.data ?? []).map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  )
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
                {TYPES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
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
