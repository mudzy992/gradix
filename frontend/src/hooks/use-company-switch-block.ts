import { useLayoutEffect } from 'react'
import { holdCompanySwitch } from '@/lib/company-switch-block'

/** Keep the lock while a controlled or uncontrolled overlay is open. */
export function useCompanySwitchBlock(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return
    return holdCompanySwitch()
  }, [active])
}
