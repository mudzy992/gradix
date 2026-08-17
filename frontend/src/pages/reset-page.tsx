import { Link, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resetPassword } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(10),
})

export function ResetPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { token: params.get('token') ?? '', newPassword: '' },
  })
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await resetPassword(values)
      toast.success(t('auth.forgotSuccess'))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.reset')}</CardTitle>
          <CardDescription>{t('auth.resetStub')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label="Token" htmlFor="token">
              <Input id="token" {...form.register('token')} />
            </Field>
            <Field label={t('auth.newPassword')} htmlFor="newPassword" hint={t('auth.minPassword')}>
              <Input id="newPassword" type="password" {...form.register('newPassword')} />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('auth.reset')}
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
