import { useEffect } from 'react'
import { i18n } from '@/i18n'
import { ApiError } from '@/lib/api-types'
import { getMe } from '@/lib/api'
import { forceLogin, refreshSession } from '@/lib/api-client'
import { readRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'

export function useAuthBootstrap(): void {
  const setReady = useAuthStore((state) => state.setReady)
  const setUser = useAuthStore((state) => state.setUser)
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const refresh = readRefreshToken()
      if (!refresh) {
        if (!cancelled) {
          setReady(true)
        }
        return
      }
      /**
       * FE-15: `refreshSession()` odbija Promise kad mreža padne. Prije toga `void run()` je ostavljao
       * **neuhvaćen `rejection`**, a `setReady(true)` se nikad nije izvršio — aplikacija je zauvijek
       * stajala na „učitavanju“ bez ijedne poruke. Sada pad mreže = nema sesije, ali aplikacija radi.
       */
      const ok = await refreshSession().catch(() => false)
      if (!ok) {
        if (!cancelled) {
          setReady(true)
        }
        return
      }
      try {
        const me = await getMe()
        if (cancelled) {
          return
        }
        setUser(me.data)
        void i18n.changeLanguage(me.data.locale)
      } catch (error) {
        // Samo neispravna sesija se odjavljuje; mrežni prekid ne smije izbrisati ispravan refresh token.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          forceLogin()
        }
      } finally {
        if (!cancelled) {
          setReady(true)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [setReady, setUser])
}
