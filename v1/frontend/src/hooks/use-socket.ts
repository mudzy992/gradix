import { useEffect } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiBase } from '@/lib/api-client'
import { KNOWN_NOTIFY_TYPES } from '@/lib/constants'
import { errorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth-store'
import type { NotificationRow } from '@/lib/api-types'

export function useSocket(): void {
  const accessToken = useAuthStore((state) => state.accessToken)
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!accessToken) {
      return
    }
    const socket: Socket = io(apiBase() || window.location.origin, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
    })
    socket.on('notification:new', (payload: NotificationRow) => {
      if (!KNOWN_NOTIFY_TYPES.includes(payload.type as (typeof KNOWN_NOTIFY_TYPES)[number])) {
        return
      }
      toast.info(payload.title)
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })
    socket.on('settings:updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['public-settings'] })
    })
    socket.on('connect_error', (error) => {
      if (import.meta.env.DEV) {
        console.debug(errorMessage(error))
      }
    })
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [accessToken, queryClient])
}
