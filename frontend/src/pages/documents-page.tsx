import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createDoc, listDocs } from '@/lib/api-polish'
import { listMachines } from '@/lib/api-fleet'
import { listUsers, uploadFile } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Kind = 'company' | 'worker' | 'machine'

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
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
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
          <ul className="grid gap-2">
            {(docs.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3 text-sm">
                <span>{row.type}</span>
                <span className="text-muted-foreground">{row.expiresAt?.slice(0, 10) ?? t('projects.dash')}</span>
              </li>
            ))}
          </ul>
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
                return
              }
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
                await client.invalidateQueries({ queryKey: ['compliance-docs'] })
              } catch (error) {
                toast.error(errorMessage(error))
              }
            }}
          >
            <Field label={t('docs.type')}>
              <Input value={docType} onChange={(event) => setDocType(event.target.value)} required />
            </Field>
            {kind === 'worker' ? (
              <Field label={t('docs.worker')}>
                <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={userId} onChange={(event) => setUserId(event.target.value)} required>
                  <option value="" />
                  {(users.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>{user.firstName} {user.lastName}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {kind === 'machine' ? (
              <Field label={t('docs.machine')}>
                <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={machineId} onChange={(event) => setMachineId(event.target.value)} required>
                  <option value="" />
                  {(machines.data ?? []).map((machine) => (
                    <option key={machine.id} value={machine.id}>{machine.name}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label={t('docs.expires')}>
              <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            </Field>
            <Field label={t('projects.upload')}>
              <Input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required />
            </Field>
            <Button type="submit">{t('common.save')}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
