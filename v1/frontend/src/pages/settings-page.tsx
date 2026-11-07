import { useTranslation } from 'react-i18next'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { useHasPermission } from '@/hooks/use-me'
import { CompanyFields } from '@/components/settings/company-fields'
import { PublicBrandFields } from '@/components/settings/public-brand-fields'
import { RegistryFields } from '@/components/settings/registry-fields'

export function SettingsPage() {
  const { t } = useTranslation()
  const tenantReady = useTenantReady()
  const publicWrite = useHasPermission('public.write')
  return (
    <div className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      {!tenantReady ? (
        <p className="text-muted-foreground">{t('settings.needCompany')}</p>
      ) : (
        <>
          <CompanyFields />
          {publicWrite ? <PublicBrandFields /> : null}
          <RegistryFields />
        </>
      )}
    </div>
  )
}
