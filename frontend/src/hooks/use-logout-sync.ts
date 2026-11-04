import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LOGOUT_KEY } from '@/lib/constants'
import { clearSession } from '@/lib/api-client'

export function useLogoutSync(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== LOGOUT_KEY) {
        return
      }
      // FE-15: ista rutina kao u meniju — store + token + keš upita.
      clearSession()
      navigate('/login', { replace: true })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [navigate])
}
