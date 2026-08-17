import { useEffect } from 'react'
import { i18n } from '@/i18n'
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
      const ok = await refreshSession()
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
      } catch {
        forceLogin()
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
