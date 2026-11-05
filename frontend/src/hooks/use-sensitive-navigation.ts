import { useCallback, useEffect, useLayoutEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { holdSensitiveNavigation, isSensitiveNavigationBlocked } from '@/lib/sensitive-navigation'

/** Register only for workflows that must not lose a one-time response. */
export function useSensitiveNavigationBlock(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    return holdSensitiveNavigation()
  }, [active])
}

/** One blocker per data router; security-driven logout remains allowed. */
export function useSensitiveNavigationGuard(): void {
  const { t } = useTranslation()
  const blocker = useBlocker(useCallback(() => isSensitiveNavigationBlocked(), []))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    blocker.reset()
    toast.error(t('common.navigationProtected'))
  }, [blocker, t])
}
