import { create } from 'zustand'
import { queryClient } from '@/lib/query-client'
import { readCompanyId, writeCompanyId } from '@/lib/storage'

type CompanyState = {
  selectedId: string | null
  setSelectedId: (id: string | null) => void
}

export const useCompanyStore = create<CompanyState>((set) => ({
  selectedId: readCompanyId(),
  setSelectedId: (id) => {
    writeCompanyId(id)
    set({ selectedId: id })
    void queryClient.invalidateQueries()
  },
}))
