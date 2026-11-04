import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getTenantCompany } from '@/lib/api'
import { uploadPublicAsset } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { publicAssetUrl } from '@/lib/api-public'
import { useAuthStore } from '@/stores/auth-store'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * FE-14 — logo za javni sajt. Nalazi: kartica je nudila izbor fajla i kad `GET` podataka firme padne
 * (upload bi tek tada pao uz toast), izbor fajla nije imao stanje (mogao se pokrenuti više puta
 * zaredom), a uz postojeći logo nije pisalo da je postavljen. Sada: kartica se skriva kad podaci firme
 * padnu (poruku i „Pokušaj ponovo“ već nosi kartica „Firma“ — bez duplog `role="alert"`), polje je
 * onemogućeno dok upload traje i piše da je logo postavljen.
 */
export function PublicBrandFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const slug = useAuthStore((state) => state.user?.company?.slug ?? '')
  const [uploading, setUploading] = useState(false)
  const company = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await getTenantCompany()).data,
  })
  const onLogo = async (file: File | undefined): Promise<void> => {
    if (!file || uploading) {
      return
    }
    setUploading(true)
    try {
      await uploadPublicAsset(file, 'LOGO')
      toast.success(t('settings.saved'))
      await queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setUploading(false)
    }
  }
  const logoAssetId = company.data?.logoAssetId
  if (company.isError) {
    return null
  }
  return (
    <Card role="region" aria-label={t('settingsPublic.logo')}>
      <CardHeader>
        <CardTitle>{t('settingsPublic.logo')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('settingsPublic.logo')} htmlFor="public-logo" hint={t('settingsPublic.logoHint')}>
          <Input
            id="public-logo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading || company.isLoading}
            onChange={(event) => void onLogo(event.target.files?.[0])}
          />
        </Field>

        {uploading ? (
          <p className="text-xs text-muted-foreground" aria-busy="true">
            {t('common.loading')}
          </p>
        ) : null}

        {logoAssetId ? (
          <div className="flex items-center gap-3">
            <img src={publicAssetUrl(logoAssetId)} alt="" width={64} height={64} className="h-16 w-16 rounded object-cover" />
            <span className="text-xs text-muted-foreground">{t('settingsPublic.logoSet')}</span>
          </div>
        ) : null}

        {slug ? (
          <a className="text-sm text-accent underline-offset-4 hover:underline" href={`/p/${slug}`}>
            {t('settingsPublic.openSite')}
          </a>
        ) : null}
      </CardContent>
    </Card>
  )
}
