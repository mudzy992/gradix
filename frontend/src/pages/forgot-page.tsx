import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { forgotPassword } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({ email: z.string().email() })

export function ForgotPage() {
  const { t } = useTranslation()
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await forgotPassword(values.email)
      toast.success(t('auth.forgotSuccess'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.forgot')}</CardTitle>
          <CardDescription>{t('auth.forgotHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label={t('auth.email')} htmlFor="email">
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('auth.send')}
            </Button>
            <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/login">
              {t('auth.backToLogin')}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
