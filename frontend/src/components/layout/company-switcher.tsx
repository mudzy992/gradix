import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getMe, listCompanies } from '@/lib/api'
import { useCompanyStore } from '@/stores/company-store'
import { useAuthStore } from '@/stores/auth-store'
import { useIsPlatform } from '@/hooks/use-me'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * FE-13 — prebacivač firme (platform admin). Nalazi: dok su firme učitavale, padala lista ili
 * `getMe` poslije prebacivanja, korisnik **nije dobijao nikakvu povratnu informaciju** — birao je
 * firmu i ostajao na podacima prethodne (`.catch(() => undefined)`). Sada: greška liste je vidljiva,
 * izbor je onemogućen dok se ne učita, a neuspjeh osvježavanja konteksta se prijavljuje.
 */
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
        value={selectedId ?? ''}
        disabled={query.isLoading || query.isError}
        onValueChange={(value) => {
          if (!setSelectedId(value || null)) {
            toast.error(t('companies.switchBlocked'))
            return
          }
          void getMe()
            .then((result) => useAuthStore.getState().setUser(result.data))
            .catch(() => toast.error(t('companies.switchError')))
        }}
      >
        <SelectTrigger aria-label={t('companies.pickCompany')}>
          <SelectValue placeholder={query.isLoading ? t('common.loading') : t('companies.none')} />
        </SelectTrigger>
        <SelectContent>
          {(query.data ?? []).map((company) => (
            <SelectItem key={company.id} value={company.id}>
              {company.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {query.isError ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {t('companies.switcherLoadError')}
        </p>
      ) : null}
    </div>
  )
}
