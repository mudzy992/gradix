import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { login } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { writeRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean(),
})

type Values = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '', remember: false },
  })
  const onSubmit = form.handleSubmit(async (values) => {
    const identifier = values.identifier.trim()
    const body = identifier.includes('@')
      ? { email: identifier, password: values.password }
      : { phone: identifier, password: values.password }
    try {
      const result = await login(body)
      writeRefreshToken(result.data.refreshToken, values.remember)
      useAuthStore.getState().setAccessToken(result.data.accessToken)
      useAuthStore.getState().setUser(result.data.user)
      void i18n.changeLanguage(result.data.user.locale)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.login')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label={t('auth.emailOrPhone')} htmlFor="identifier">
              <Input id="identifier" autoComplete="username" {...form.register('identifier')} />
            </Field>
            <Field label={t('auth.password')} htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.watch('remember')}
                onCheckedChange={(checked) => form.setValue('remember', checked === true)}
              />
              {t('auth.remember')}
            </label>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('auth.submit')}
            </Button>
            <Link className="text-sm text-primary underline-offset-4 hover:underline" to="/forgot">
              {t('auth.forgot')}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
