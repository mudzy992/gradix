import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * BE-02: backend `POST /api/auth/reset` odgovara `501 AUTH_RESET_NOT_AVAILABLE`
 * (nema modela za reset tokene ni prave email dostave), pa stranica ne nudi formu
 * koja bi glumila uspjeh. Pravi tok (token + email) dolazi u kasnijem segmentu
 * zajedno sa `EmailService`-om; do tada ADMIN resetuje lozinku kroz `/users`.
 */
export function ResetPage() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('auth.reset')}</CardTitle>
          <CardDescription>{t('auth.resetStub')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login">{t('auth.backToLogin')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
