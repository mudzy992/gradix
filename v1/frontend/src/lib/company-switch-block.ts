/** In-memory locks protect work owned by the current company. */
const blockers = new Set<symbol>()

export function holdCompanySwitch(): () => void {
  const id = Symbol('company-switch-block')
  blockers.add(id)
  return () => { blockers.delete(id) }
}

export function isCompanySwitchBlocked(): boolean {
  return blockers.size > 0
}

