import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { AuthCard } from '@/components/auth/auth-card'

/**
 * BE-02: backend `POST /api/auth/reset` odgovara `501 AUTH_RESET_NOT_AVAILABLE`
 * (nema modela za reset tokene ni prave email dostave), pa stranica **ne nudi** formu
 * koja bi glumila uspjeh. Pravi tok (token + email) dolazi u kasnijem segmentu
 * zajedno sa `EmailService`-om; do tada ADMIN resetuje lozinku kroz `/users`.
 *
 * FE-07: ekran ima `h1` i kaže šta korisnik **sada** može (kontakt administratora), umjesto
 * mrtvog kraja sa jednim dugmetom.
 */
export function ResetPage() {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.reset')} description={t('auth.resetStub')}>
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('auth.resetHow')}</p>
        <Button asChild variant="outline" className="w-full">
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </Button>
      </div>
    </AuthCard>
  )
}
