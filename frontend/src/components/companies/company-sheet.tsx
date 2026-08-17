import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createCompany, patchCompanyPlatform } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import type { CompanyRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Values = {
  name: string
  slug: string
  firstName: string
  lastName: string
  email: string
}

type Props = {
  company: CompanyRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (temporaryPassword: string) => void
  onSaved: () => void
}

export function CompanySheet({ company, open, onOpenChange, onCreated, onSaved }: Props) {
  const { t } = useTranslation()
  const form = useForm<Values>({
    values: {
      name: company?.name ?? '',
      slug: company?.slug ?? '',
      firstName: '',
      lastName: '',
      email: '',
    },
  })
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (company) {
        await patchCompanyPlatform(company.id, {
          name: values.name,
          legalName: company.legalName,
        })
        onSaved()
      } else {
        const created = await createCompany({
          name: values.name,
          slug: values.slug,
          admin: {
            firstName: values.firstName,
            lastName: values.lastName,
            email: values.email,
          },
        })
        onCreated(created.data.temporaryPassword)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{company ? t('companies.edit') : t('companies.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-4 px-4" onSubmit={onSubmit}>
          <Field label={t('settings.name')} htmlFor="name">
            <Input id="name" {...form.register('name', { required: true })} />
          </Field>
          <Field label={t('settings.slug')} htmlFor="slug" hint={t('companies.slugHint')}>
            <Input id="slug" disabled={Boolean(company)} {...form.register('slug', { required: !company })} />
          </Field>
          {!company ? (
            <>
              <p className="text-sm font-medium">{t('companies.admin')}</p>
              <Field label={t('users.firstName')} htmlFor="adminFirst">
                <Input id="adminFirst" {...form.register('firstName', { required: true })} />
              </Field>
              <Field label={t('users.lastName')} htmlFor="adminLast">
                <Input id="adminLast" {...form.register('lastName', { required: true })} />
              </Field>
              <Field label={t('auth.email')} htmlFor="adminEmail">
                <Input id="adminEmail" type="email" {...form.register('email', { required: true })} />
              </Field>
            </>
          ) : null}
          <SheetFooter>
            <Button type="submit">{t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
