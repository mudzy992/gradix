import { useCallback, useEffect, useRef, useState } from 'react'
import { i18n } from '@/i18n'
import { ApiError } from '@/lib/api-types'
import { getMe } from '@/lib/api'
import { forceLogin, refreshSession } from '@/lib/api-client'
import { getSessionGeneration, readRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'

type RecoverableError = 'RATE_LIMITED' | 'NETWORK_ERROR'

export function useAuthBootstrap() {
  const [error, setError] = useState<RecoverableError | null>(null)
  const [attempt, setAttempt] = useState(0)
  // After a successful rotation, retry a failed profile read without rotating again.
  const refreshedGeneration = useRef<number | null>(null)
  const user = useAuthStore((state) => state.user)
  const setReady = useAuthStore((state) => state.setReady)
  const setUser = useAuthStore((state) => state.setUser)
  useEffect(() => {
    if (user) setError(null)
  }, [user])
  useEffect(() => {
    let cancelled = false
    const recordRecoverableError = (caught: unknown) => {
      if (!cancelled && !useAuthStore.getState().user && caught instanceof ApiError && (caught.code === 'RATE_LIMITED' || caught.code === 'NETWORK_ERROR')) {
        setError(caught.code)
      }
    }
    const run = async (): Promise<void> => {
      const refresh = readRefreshToken()
      if (!refresh) {
        if (!cancelled) {
          setReady(true)
        }
        return
      }
      // A temporary failure is recoverable without throwing away the credential.
      const hasCurrentAccess = refreshedGeneration.current === getSessionGeneration() && Boolean(useAuthStore.getState().accessToken)
      if (!hasCurrentAccess) {
        const refreshGeneration = getSessionGeneration()
        const ok = await refreshSession().catch((caught: unknown) => {
          recordRecoverableError(caught)
          return false
        })
        if (cancelled) return
        if (getSessionGeneration() !== refreshGeneration) {
          setReady(true)
          return
        }
        if (!ok) {
          setReady(true)
          return
        }
        refreshedGeneration.current = getSessionGeneration()
      }
      const generation = getSessionGeneration()
      try {
        const me = await getMe()
        if (cancelled || getSessionGeneration() !== generation) {
          return
        }
        setUser(me.data)
        void i18n.changeLanguage(me.data.locale)
      } catch (error) {
        if (cancelled || getSessionGeneration() !== generation) return
        // Only an invalid session is logged out. Transient failures offer retry.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          forceLogin()
        } else {
          recordRecoverableError(error)
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
  }, [setReady, setUser, attempt])
  const retry = useCallback(() => {
    setError(null)
    setReady(false)
    setAttempt((value) => value + 1)
  }, [setReady])
  const continueWithoutRecovery = useCallback(() => setError(null), [])
  return { error, retry, continueWithoutRecovery }
}
