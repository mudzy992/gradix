import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { changePassword, logout } from '@/lib/api'
import { clearSession } from '@/lib/api-client'
import { readRefreshToken } from '@/lib/storage'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/field'
import { AuthCard } from '@/components/auth/auth-card'
import { PasswordInput } from '@/components/auth/password-input'

// FE-07: poruke su i18n ključevi — ranije je `min(10)` bacao **engleski** Zod tekst i to nigdje
// nije prikazan (forma nije prosljeđivala `error` u `Field`), pa je korisnik dobijao tiho odbijenu
// formu bez objašnjenja.
const schema = z.object({
  currentPassword: z.string().min(1, 'auth.required'),
  newPassword: z.string().min(10, 'auth.minPassword'),
})

type Props = {
  forced?: boolean
}

export function ChangePasswordPage({ forced = false }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '' },
  })
  const errors = form.formState.errors
  const leave = async (): Promise<void> => {
    const refresh = readRefreshToken()
    try {
      if (refresh) {
        await logout(refresh)
      }
    } catch {
      /* ignore */
    }
    clearSession()
    navigate('/login', { replace: true })
  }
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await changePassword(values)
      clearSession()
      navigate('/login', { replace: true, state: { changed: true } })
    } catch (error) {
      setFormError(errorMessage(error))
    }
  })
  return (
    <AuthCard
      title={t('auth.changePassword')}
      description={forced ? t('auth.mustChange') : t('auth.changeHint')}
      standalone={forced}
      className={forced ? undefined : 'mx-auto'}
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <Field
          label={t('auth.currentPassword')}
          htmlFor="currentPassword"
          error={errors.currentPassword?.message ? t(errors.currentPassword.message) : undefined}
        >
          <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register('currentPassword')} />
        </Field>
        <Field
          label={t('auth.newPassword')}
          htmlFor="newPassword"
          hint={t('auth.minPassword')}
          error={errors.newPassword?.message ? t(errors.newPassword.message) : undefined}
        >
          <PasswordInput id="newPassword" autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('auth.changeSubmit')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void leave()}>
          {t('auth.logout')}
        </Button>
      </form>
    </AuthCard>
  )
}
