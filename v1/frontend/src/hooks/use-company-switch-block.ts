import { useLayoutEffect } from 'react'
import { holdCompanySwitch } from '@/lib/company-switch-block'

/** Keep the lock while a modal, draft or other protected state is active. */
export function useCompanySwitchBlock(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    return holdCompanySwitch()
  }, [active])
}
