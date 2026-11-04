import { create } from 'zustand'
import { queryClient } from '@/lib/query-client'
import { PROJECT_DOCUMENT_PENDING_QUERY } from '@/lib/constants'
import { isCompanySwitchBlocked } from '@/lib/company-switch-block'
import { readCompanyId, writeCompanyId } from '@/lib/storage'

type CompanyState = {
  selectedId: string | null
  revision: number
  setSelectedId: (id: string | null) => boolean
}

export const useCompanyStore = create<CompanyState>((set, get) => ({
  selectedId: readCompanyId(),
  revision: 0,
  setSelectedId: (id) => {
    if (get().selectedId === id) return true
    if (isCompanySwitchBlocked()) return false
    writeCompanyId(id)
    set((state) => ({ selectedId: id, revision: state.revision + 1 }))
    // Invalidation alone leaves the previous company's data visible while a
    // refetch is pending or fails. Reset both active and inactive data first.
    // Document recovery is separately scoped to session/user/company/project.
    void queryClient.resetQueries({
      predicate: (query) => query.queryKey[0] !== PROJECT_DOCUMENT_PENDING_QUERY,
    })
    return true
  },
}))
