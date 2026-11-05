import { useAuthStore } from '@/stores/auth-store'

// Multiple open workflows have independent lifetimes. Never retain the secret itself.
const blockers = new Set<symbol>()

export function isSensitiveNavigationBlocked(): boolean {
  // Session teardown must not be obstructed, even if a workflow is still mounted.
  return blockers.size > 0 && useAuthStore.getState().user !== null
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (!isSensitiveNavigationBlocked()) return
  event.preventDefault()
  event.returnValue = ''
}

export function holdSensitiveNavigation(): () => void {
  const token = Symbol('sensitive-navigation')
  if (blockers.size === 0) window.addEventListener('beforeunload', beforeUnload)
  blockers.add(token)
  return () => {
    if (!blockers.delete(token)) return
    if (blockers.size === 0) window.removeEventListener('beforeunload', beforeUnload)
  }
}
