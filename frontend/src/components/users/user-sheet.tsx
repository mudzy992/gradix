import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
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
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'

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

/**
 * FE-13 — obrazac korisnika. Nalazi: satnica je bila **slobodan tekst** („abc“ je išlo na API i
 * vraćalo 400 bez objašnjenja uz polje), izbor uloga nije imao poruku kad se sve odznači, a
 * onemogućen email nije imao razlog. Sada: satnica se validira uz polje (`Field error`), uloge imaju
 * vlastitu poruku, a email nosi hint „ne može se mijenjati“.
 */
export function UserSheet({ user, open, onOpenChange, onCreated, onSaved }: Props) {
  const { t } = useTranslation()
  useSensitiveNavigationBlock(open)
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  useEffect(() => { if (!open) { uncertainRef.current = false; setUncertain(false) } }, [open])
  const me = useAuthStore((state) => state.user)
  const canRate = useHasPermission('payroll.write')
  const options = me ? assignableRoles(me) : []
  const form = useForm<Values>({
    // FE-13: satnica postoji samo uz `payroll.write` — `shouldUnregister` sklanja pravilo kad se
    // polje odmontira (inače validacija pada na polju koje korisnik ne vidi).
    shouldUnregister: true,
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
  // `roles` nije `<input>` pa ga `shouldUnregister` ne drži u formi — čitamo ga uz rezervu.
  const roles = form.watch('roles') ?? []
  const rolesError = form.formState.errors.roles?.message
  const toggleRole = (role: AppRole, checked: boolean): void => {
    const next = checked ? [...roles, role] : roles.filter((item) => item !== role)
    form.setValue('roles', next, { shouldValidate: true })
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (savingRef.current || (!user && uncertainRef.current)) return
    const nextRoles = values.roles ?? []
    if (nextRoles.length === 0) {
      form.setError('roles', { message: t('users.rolesRequired') })
      return
    }
    form.clearErrors('roles')
    const body: Record<string, unknown> = {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      employeeCode: values.employeeCode || undefined,
      roles: nextRoles,
    }
    if (canRate && values.hourlyRate) {
      body.hourlyRate = values.hourlyRate
    }
    savingRef.current = true
    setSaving(true)
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
      if (!user) { uncertainRef.current = true; setUncertain(true) }
      toast.error(errorMessage(error))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  })
  return (
    <Sheet open={open} onOpenChange={(next) => { if (next || !savingRef.current) onOpenChange(next) }}>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user ? t('users.edit') : t('users.create')}</SheetTitle>
        </SheetHeader>
        <form className="grid gap-4 px-4" onSubmit={onSubmit} aria-busy={saving}>
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          <fieldset disabled={saving} className="grid gap-4">
            <Field label={t('users.firstName')} htmlFor="firstName" error={form.formState.errors.firstName?.message}>
              <Input
                id="firstName"
                {...form.register('firstName', { required: t('common.required') })}
              />
            </Field>
            <Field label={t('users.lastName')} htmlFor="lastName" error={form.formState.errors.lastName?.message}>
              <Input id="lastName" {...form.register('lastName', { required: t('common.required') })} />
            </Field>
            <Field
              label={t('auth.email')}
              htmlFor="email"
              hint={user ? t('users.emailLocked') : undefined}
              error={form.formState.errors.email?.message}
            >
              <Input
                id="email"
                type="email"
                disabled={Boolean(user)}
                {...form.register('email', { required: user ? false : t('common.required') })}
              />
            </Field>
            <Field label={t('auth.phone')} htmlFor="phone" hint={t('users.phoneHint')}>
              <Input id="phone" {...form.register('phone')} />
            </Field>
            <Field label={t('users.employeeCode')} htmlFor="employeeCode">
              <Input id="employeeCode" {...form.register('employeeCode')} />
            </Field>
            {canRate ? (
              <Field
                label={t('users.hourlyRate')}
                htmlFor="hourlyRate"
                hint={t('users.rateHint')}
                error={form.formState.errors.hourlyRate?.message}
              >
                <Input
                  id="hourlyRate"
                  inputMode="decimal"
                  {...form.register('hourlyRate', {
                    validate: (value) =>
                      value === '' || (Number.isFinite(Number(value)) && Number(value) > 0)
                        ? true
                        : t('users.rateInvalid'),
                  })}
                />
              </Field>
            ) : null}
            <fieldset
              className="grid gap-2"
              aria-describedby={rolesError ? 'roles-error' : undefined}
              aria-invalid={rolesError ? true : undefined}
            >
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
              {rolesError ? (
                <p id="roles-error" role="alert" className="text-xs font-medium text-destructive">
                  {rolesError}
                </p>
              ) : null}
            </fieldset>
            {uncertain ? (
              <div className="grid gap-2">
                <p role="alert" className="text-sm text-destructive">{t('common.createUnknown')}</p>
                <Button type="button" variant="outline" onClick={() => { uncertainRef.current = false; setUncertain(false) }}>{t('common.enableRetry')}</Button>
              </div>
            ) : null}
            <SheetFooter>
              <Button type="submit" disabled={uncertain}>{t('common.save')}</Button>
            </SheetFooter>
          </fieldset>
        </form>
      </SheetContent>
    </Sheet>
  )
}
