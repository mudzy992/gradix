import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createProject, patchProject } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import type { ProjectRow } from '@/lib/ops-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Values = {
  name: string
  code: string
  locality: string
  plannedBudget: string
  client: string
  plannedStart: string
  plannedEnd: string
}

type Props = {
  project: ProjectRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function ProjectSheet({ project, open, onOpenChange, onSaved }: Props) {
  const { t } = useTranslation()
  const form = useForm<Values>({
    values: {
      name: project?.name ?? '',
      code: project?.code ?? '',
      locality: project?.locality ?? '',
      plannedBudget: project?.plannedBudget ?? '',
      client: project?.client ?? '',
      plannedStart: project?.plannedStart?.slice(0, 10) ?? '',
      plannedEnd: project?.plannedEnd?.slice(0, 10) ?? '',
    },
  })
  const { dirtyFields } = form.formState
  const onSubmit = form.handleSubmit(async (values) => {
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      // PATCH only changed optional fields: fields hidden by the API must not be erased.
      code: project ? (dirtyFields.code ? values.code : undefined) : values.code || undefined,
      locality: project ? (dirtyFields.locality ? values.locality : undefined) : values.locality || undefined,
      plannedBudget: project ? (dirtyFields.plannedBudget ? values.plannedBudget : undefined) : values.plannedBudget || undefined,
      client: project ? (dirtyFields.client ? values.client : undefined) : values.client || undefined,
      // On PATCH an empty string means clear the optional date. On create it is omitted.
      plannedStart: project ? values.plannedStart : values.plannedStart || undefined,
      plannedEnd: project ? values.plannedEnd : values.plannedEnd || undefined,
    }
    try {
      if (project) {
        await patchProject(project.id, body)
      } else {
        await createProject(body)
      }
      onSaved()
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{project ? t('users.edit') : t('projects.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-3 p-4" onSubmit={onSubmit}>
          <Field label={t('projects.name')} htmlFor="name" error={form.formState.errors.name?.message}>
            <Input id="name" {...form.register('name', { validate: (value) => Boolean(value.trim()) || t('common.required') })} />
          </Field>
          <Field label={t('projects.code')} htmlFor="code">
            <Input id="code" {...form.register('code')} />
          </Field>
          <Field label={t('projects.locality')} htmlFor="locality">
            <Input id="locality" {...form.register('locality')} />
          </Field>
          <Field label={t('projects.budget')} htmlFor="budget">
            <Input id="budget" {...form.register('plannedBudget')} />
          </Field>
          <Field label={t('projects.client')} htmlFor="client">
            <Input id="client" {...form.register('client')} />
          </Field>
          <Field label={t('projects.plannedStart')} htmlFor="start">
            <Input id="start" type="date" {...form.register('plannedStart')} />
          </Field>
          <Field label={t('projects.plannedEnd')} htmlFor="end">
            <Input id="end" type="date" {...form.register('plannedEnd')} />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>{t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
