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

export function PublicBrandFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const slug = useAuthStore((state) => state.user?.company?.slug ?? '')
  const company = useQuery({
    queryKey: ['company'],
    queryFn: async () => (await getTenantCompany()).data,
  })
  const onLogo = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return
    }
    try {
      await uploadPublicAsset(file, 'LOGO')
      toast.success(t('settings.saved'))
      await queryClient.invalidateQueries({ queryKey: ['company'] })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const logoAssetId = company.data?.logoAssetId
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
            onChange={(event) => void onLogo(event.target.files?.[0])}
          />
        </Field>
        {logoAssetId ? (
          <img src={publicAssetUrl(logoAssetId)} alt="" className="h-16 w-16 rounded object-cover" />
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
