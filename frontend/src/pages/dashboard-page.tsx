import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getDashboard } from '@/lib/api-ops'
import { dash } from '@/lib/dash'
import { displayName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function DashboardPage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const tenantReady = useTenantReady()
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await getDashboard()).data,
    enabled: tenantReady,
  })
  const cards = query.data?.cards ?? []
  const presence = query.data?.presence
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('dashboard.welcome', { name: user ? displayName(user) : '' })}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.key}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(`dash.${card.key}`)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{dash(card.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {presence ? (
        <section className="grid gap-2">
          <h2 className="text-lg font-medium">{t('dashboard.onSite')}</h2>
          {presence.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('projects.dash')}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {presence.map((person) => (
                <li key={person.userId}>
                  {person.firstName} {person.lastName}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {query.data?.expiring && query.data.expiring.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="text-lg font-medium">{t('dash.expiring')}</h2>
          <ul className="grid gap-1 text-sm">
            {query.data.expiring.map((item) => (
              <li key={item.entityId}>
                {item.type} · {item.daysLeft}d
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
