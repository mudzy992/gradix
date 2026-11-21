import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createTask, listProjects } from '@/lib/api-ops'
import { listUsers } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { displayName } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function DispatchSheet({ open, onOpenChange, onSaved }: Props) {
  const { t } = useTranslation()
  const projects = useQuery({
    queryKey: ['projects', { limit: 100 }],
    queryFn: async () => (await listProjects({ limit: 100 })).data,
    enabled: open,
  })
  const users = useQuery({
    queryKey: ['users', { limit: 100 }],
    queryFn: async () => (await listUsers({ limit: 100 })).data,
    enabled: open,
  })
  const form = useForm({ defaultValues: { projectId: '', title: '', assigneeId: '' } })
  const onSubmit = form.handleSubmit(async (values) => {
    if (!projects.isSuccess) return
    try {
      await createTask({
        projectId: values.projectId,
        title: values.title.trim(),
        assigneeIds: values.assigneeId ? [values.assigneeId] : [],
      })
      onSaved()
      onOpenChange(false)
      form.reset()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('tasks.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-3 p-4" onSubmit={onSubmit}>
          {projects.isLoading ? <p role="status">{t('common.loading')}</p> : null}
          {projects.isError ? (
            <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <span>{t('projects.loadError')}</span>
              <Button size="sm" variant="outline" type="button" onClick={() => void projects.refetch()}>{t('dashboard.retry')}</Button>
            </div>
          ) : null}
          <Field label={t('projects.title')} htmlFor="projectId" error={form.formState.errors.projectId?.message}>
            <select id="projectId" disabled={!projects.isSuccess} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" {...form.register('projectId', { required: t('common.required') })}>
              <option value="" />
              {(projects.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </Field>
          <Field label={t('projects.name')} htmlFor="title" error={form.formState.errors.title?.message}>
            <Input id="title" {...form.register('title', { validate: (value) => Boolean(value.trim()) || t('common.required') })} />
          </Field>
          {users.isError ? (
            <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <span>{t('users.loadError')}</span>
              <Button size="sm" variant="outline" type="button" onClick={() => void users.refetch()}>{t('dashboard.retry')}</Button>
            </div>
          ) : null}
          <Field label={t('tasks.assignees')} htmlFor="assigneeId">
            <select id="assigneeId" disabled={!users.isSuccess} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" {...form.register('assigneeId')}>
              <option value="" />
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>{displayName(user)}</option>
              ))}
            </select>
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={!projects.isSuccess || form.formState.isSubmitting}>{t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
