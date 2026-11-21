import type { ReactNode } from 'react'
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap'
import { useAuthStore } from '@/stores/auth-store'
import { ScreenLoader } from '@/components/layout/screen-loader'
import { SessionRecovery } from '@/components/auth/session-recovery'

export function BootGate({ children }: { children: ReactNode }) {
  const recovery = useAuthBootstrap()
  const user = useAuthStore((state) => state.user)
  const bootReady = useAuthStore((state) => state.ready)
  if (!bootReady) return <ScreenLoader className="min-h-svh" />
  if (recovery.error && !user) {
    return <SessionRecovery error={recovery.error} onRetry={recovery.retry} onContinue={recovery.continueWithoutRecovery} />
  }
  return children
}
