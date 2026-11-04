import { create } from 'zustand'
import { queryClient } from '@/lib/query-client'
import { readCompanyId, writeCompanyId } from '@/lib/storage'

type CompanyState = {
  selectedId: string | null
  revision: number
  setSelectedId: (id: string | null) => void
}

export const useCompanyStore = create<CompanyState>((set) => ({
  selectedId: readCompanyId(),
  revision: 0,
  setSelectedId: (id) => {
    writeCompanyId(id)
    set((state) => ({ selectedId: id, revision: state.revision + (state.selectedId === id ? 0 : 1) }))
    void queryClient.invalidateQueries()
  },
}))
