import { useQuery } from '@tanstack/react-query'
import { getPublicSettings } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export function usePublicSettings() {
  const slug = useAuthStore((state) => state.user?.company?.slug)
  return useQuery({
    queryKey: ['public-settings', slug],
    queryFn: async () => (await getPublicSettings(slug ?? '')).data,
    enabled: Boolean(slug),
  })
}

export function useDisplayPrefs(): { timeZone: string; dateFormat: string } {
  const settings = usePublicSettings().data
  return {
    timeZone: String(settings?.['app.timezone'] ?? 'Europe/Sarajevo'),
    dateFormat: String(settings?.['app.dateFormat'] ?? 'dd.MM.yyyy'),
  }
}
