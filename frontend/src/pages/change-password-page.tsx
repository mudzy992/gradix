import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { changePassword, logout } from '@/lib/api'
import { clearRefreshToken, readRefreshToken } from '@/lib/storage'
import { errorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10),
})

type Props = {
  forced?: boolean
}

export function ChangePasswordPage({ forced = false }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '' },
  })
  const leave = async (): Promise<void> => {
    const refresh = readRefreshToken()
    try {
      if (refresh) {
        await logout(refresh)
      }
    } catch {
      /* ignore */
    }
    useAuthStore.getState().clear()
    clearRefreshToken()
    navigate('/login', { replace: true })
  }
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await changePassword(values)
      useAuthStore.getState().clear()
      clearRefreshToken()
      toast.success(t('auth.changeSuccess'))
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  })
  return (
    <div className={forced ? 'flex min-h-svh items-center justify-center p-4' : undefined}>
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.changePassword')}</CardTitle>
          {forced ? <CardDescription>{t('auth.mustChange')}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={onSubmit}>
            <Field label={t('auth.currentPassword')} htmlFor="currentPassword">
              <Input id="currentPassword" type="password" {...form.register('currentPassword')} />
            </Field>
            <Field label={t('auth.newPassword')} htmlFor="newPassword" hint={t('auth.minPassword')}>
              <Input id="newPassword" type="password" {...form.register('newPassword')} />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void leave()}>
              {t('auth.logout')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
