import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LOGOUT_KEY } from '@/lib/constants'
import { clearRefreshToken } from '@/lib/storage'
import { useAuthStore } from '@/stores/auth-store'

export function useLogoutSync(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== LOGOUT_KEY) {
        return
      }
      useAuthStore.getState().clear()
      clearRefreshToken()
      navigate('/login', { replace: true })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [navigate])
}
