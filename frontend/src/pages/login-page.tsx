import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n'
import { login } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { writeRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/field'
import { AuthCard } from '@/components/auth/auth-card'
import { PasswordInput } from '@/components/auth/password-input'

// FE-03: poruke su i18n ključevi (prevode se pri prikazu), a ne fiksni tekst.
const schema = z.object({
  identifier: z.string().min(1, 'auth.required'),
  password: z.string().min(1, 'auth.required'),
  remember: z.boolean(),
})

type Values = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '', remember: false },
  })
  const errors = form.formState.errors
  const errorText = (message?: string) => (message ? t(message) : undefined)
  const onSubmit = form.handleSubmit(async (values) => {
    const identifier = values.identifier.trim()
    const body = identifier.includes('@')
      ? { email: identifier, password: values.password }
      : { phone: identifier, password: values.password }
    setFormError(null)
    try {
      const result = await login(body)
      writeRefreshToken(result.data.refreshToken, values.remember)
      useAuthStore.getState().setAccessToken(result.data.accessToken)
      useAuthStore.getState().setUser(result.data.user)
      void i18n.changeLanguage(result.data.user.locale)
    } catch (error) {
      // FE-07: greška servera (pogrešna lozinka, 429 zbog previše pokušaja, mreža) ostaje **na ekranu**
      // dok je korisnik ne otkloni — toast bi nestao prije nego što ga pročita.
      setFormError(errorMessage(error))
    }
  })
  return (
    <AuthCard title={t('auth.login')}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <Field
          label={t('auth.emailOrPhone')}
          htmlFor="identifier"
          error={errorText(errors.identifier?.message)}
        >
          <Input id="identifier" autoComplete="username" {...form.register('identifier')} />
        </Field>
        <Field label={t('auth.password')} htmlFor="password" error={errorText(errors.password?.message)}>
          <PasswordInput id="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id="remember"
            checked={form.watch('remember')}
            onCheckedChange={(checked) => form.setValue('remember', checked === true)}
          />
          <Label htmlFor="remember" className="font-normal">
            {t('auth.remember')}
          </Label>
        </div>
        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {t('auth.submit')}
        </Button>
        <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/forgot">
          {t('auth.forgot')}
        </Link>
      </form>
    </AuthCard>
  )
}
