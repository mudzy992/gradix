import { useCompanyStore } from '@/stores/company-store'
import { useIsPlatform } from '@/hooks/use-me'

export function useTenantReady(): boolean {
  const isPlatform = useIsPlatform()
  const selectedId = useCompanyStore((state) => state.selectedId)
  if (!isPlatform) {
    return true
  }
  return Boolean(selectedId)
}
