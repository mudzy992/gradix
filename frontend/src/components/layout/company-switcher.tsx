import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getMe, listCompanies } from '@/lib/api'
import { useCompanyStore } from '@/stores/company-store'
import { useAuthStore } from '@/stores/auth-store'
import { useIsPlatform } from '@/hooks/use-me'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function CompanySwitcher() {
  const { t } = useTranslation()
  const isPlatform = useIsPlatform()
  const selectedId = useCompanyStore((state) => state.selectedId)
  const setSelectedId = useCompanyStore((state) => state.setSelectedId)
  const query = useQuery({
    queryKey: ['companies', 'switcher'],
    queryFn: async () => (await listCompanies({ limit: 100 })).data,
    enabled: isPlatform,
  })
  if (!isPlatform) {
    return null
  }
  return (
    <div className="grid gap-1">
      <span className="px-1 text-xs text-muted-foreground">{t('companies.switcher')}</span>
      <Select
        value={selectedId ?? undefined}
        onValueChange={(value) => {
          setSelectedId(value || null)
          void getMe()
            .then((result) => useAuthStore.getState().setUser(result.data))
            .catch(() => undefined)
        }}
      >
        <SelectTrigger aria-label={t('companies.pickCompany')}>
          <SelectValue placeholder={t('companies.none')} />
        </SelectTrigger>
        <SelectContent>
          {(query.data ?? []).map((company) => (
            <SelectItem key={company.id} value={company.id}>
              {company.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
