import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createUser, patchUser } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { assignableRoles } from '@/lib/roles'
import type { AppRole } from '@/lib/constants'
import type { ListUser } from '@/lib/api-types'
import { useAuthStore } from '@/stores/auth-store'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/field'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

type Values = {
  firstName: string
  lastName: string
  email: string
  phone: string
  employeeCode: string
  hourlyRate: string
  roles: AppRole[]
}

type Props = {
  user: ListUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (temporaryPassword: string) => void
  onSaved: () => void
}

export function UserSheet({ user, open, onOpenChange, onCreated, onSaved }: Props) {
  const { t } = useTranslation()
  const me = useAuthStore((state) => state.user)
  const canRate = useHasPermission('payroll.write')
  const options = me ? assignableRoles(me) : []
  const form = useForm<Values>({
    values: {
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      employeeCode: user?.employeeCode ?? '',
      hourlyRate: user?.hourlyRate ?? '',
      roles: user?.roles ?? [],
    },
  })
  const roles = form.watch('roles')
  const toggleRole = (role: AppRole, checked: boolean): void => {
    const next = checked ? [...roles, role] : roles.filter((item) => item !== role)
    form.setValue('roles', next)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (values.roles.length === 0) {
      toast.error(t('errors.VALIDATION_FAILED'))
      return
    }
    const body: Record<string, unknown> = {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      employeeCode: values.employeeCode || undefined,
      roles: values.roles,
    }
    if (canRate && values.hourlyRate) {
      body.hourlyRate = values.hourlyRate
    }
    try {
      if (user) {
        await patchUser(user.id, body)
        onSaved()
      } else {
        const created = await createUser({ ...body, email: values.email })
        onCreated(created.data.temporaryPassword)
      }
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user ? t('users.edit') : t('users.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-4 px-4" onSubmit={onSubmit}>
          <Field label={t('users.firstName')} htmlFor="firstName">
            <Input id="firstName" {...form.register('firstName', { required: true })} />
          </Field>
          <Field label={t('users.lastName')} htmlFor="lastName">
            <Input id="lastName" {...form.register('lastName', { required: true })} />
          </Field>
          <Field label={t('auth.email')} htmlFor="email">
            <Input id="email" type="email" disabled={Boolean(user)} {...form.register('email', { required: !user })} />
          </Field>
          <Field label={t('auth.phone')} htmlFor="phone" hint={t('users.phoneHint')}>
            <Input id="phone" {...form.register('phone')} />
          </Field>
          <Field label={t('users.employeeCode')} htmlFor="employeeCode">
            <Input id="employeeCode" {...form.register('employeeCode')} />
          </Field>
          {canRate ? (
            <Field label={t('users.hourlyRate')} htmlFor="hourlyRate">
              <Input id="hourlyRate" {...form.register('hourlyRate')} />
            </Field>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('users.roles')}</legend>
            {options.map((role) => (
              <label key={role} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={roles.includes(role)}
                  onCheckedChange={(checked) => toggleRole(role, checked === true)}
                />
                {t(`roles.${role}`)}
              </label>
            ))}
          </fieldset>
          <SheetFooter>
            <Button type="submit">{t('common.save')}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
