import { useQuery } from '@tanstack/react-query'
import { getMe } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

export function useMeQuery() {
  const accessToken = useAuthStore((state) => state.accessToken)
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const result = await getMe()
      useAuthStore.getState().setUser(result.data)
      return result.data
    },
    enabled: Boolean(accessToken),
  })
}

/**
 * FE-13: `roles`/`permissions` su nizovi — ako ih korisnik nema (npr. djelimičan odgovor poslije
 * osvježavanja konteksta firme), ekran bi pao na `undefined.includes`. Umjesto toga: nema prava.
 */
export function useHasPermission(permission: string): boolean {
  const user = useAuthStore((state) => state.user)
  return user?.permissions?.includes(permission) ?? false
}

export function useIsPlatform(): boolean {
  const user = useAuthStore((state) => state.user)
  return user?.roles?.includes('PLATFORM_ADMIN') ?? false
}
