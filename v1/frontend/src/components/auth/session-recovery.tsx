import { useTranslation } from 'react-i18next'
import { AuthCard } from '@/components/auth/auth-card'
import { Button } from '@/components/ui/button'

type Props = {
  error: 'RATE_LIMITED' | 'NETWORK_ERROR' | 'AUTH_REFRESH_UNCERTAIN'
  onRetry: () => void
  onContinue: () => void
}

/** Temporary bootstrap failures must not silently discard a recoverable session. */
export function SessionRecovery({ error, onRetry, onContinue }: Props) {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.recoveryTitle')} description={t(error === 'AUTH_REFRESH_UNCERTAIN' ? 'auth.recoveryUncertainHint' : 'auth.recoveryHint')}>
      <div className="grid gap-4">
        <p role="alert" className="text-sm text-destructive">{t(`errors.${error}`)}</p>
        {error !== 'AUTH_REFRESH_UNCERTAIN' && <Button type="button" onClick={onRetry}>{t('auth.recoveryRetry')}</Button>}
        <Button type="button" variant="outline" onClick={onContinue}>{t('auth.recoveryContinue')}</Button>
      </div>
    </AuthCard>
  )
}
