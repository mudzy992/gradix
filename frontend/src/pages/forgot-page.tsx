import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { forgotPassword } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { AuthCard } from '@/components/auth/auth-card'

const schema = z.object({ email: z.string().min(1, 'auth.required').email('auth.emailInvalid') })

type Values = z.infer<typeof schema>

export function ForgotPage() {
  const { t } = useTranslation()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null)
    try {
      await forgotPassword(values.email)
      // FE-07: potvrda je **stanje ekrana** (`role="status"`), ne toast koji nestane — korisnik
      // mora moći pročitati na koji email je uputa otišla i poslati ponovo.
      setSentTo(values.email)
    } catch (error) {
      setFormError(errorMessage(error))
    }
  })
  if (sentTo) {
    return (
      <AuthCard title={t('auth.forgot')} description={t('auth.forgotSentTitle')}>
        <div className="grid gap-4">
          <p role="status" className="text-sm">
            {t('auth.forgotSent', { email: sentTo })}
          </p>
          <Button type="button" variant="outline" onClick={() => setSentTo(null)}>
            {t('auth.forgotResend')}
          </Button>
          <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/login">
            {t('auth.backToLogin')}
          </Link>
        </div>
      </AuthCard>
    )
  }
  return (
    <AuthCard title={t('auth.forgot')} description={t('auth.forgotHint')}>
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <Field label={t('auth.email')} htmlFor="email" error={form.formState.errors.email?.message ? t(form.formState.errors.email.message) : undefined}>
          <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
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
          {t('auth.send')}
        </Button>
        <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/login">
          {t('auth.backToLogin')}
        </Link>
      </form>
    </AuthCard>
  )
}
