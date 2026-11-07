import { api } from '@/lib/api-client'
import type { CatalogRow, FuelRow, MachineRow, TripRow } from '@/lib/ops-types'

export function listMachines(query: { page?: number; status?: string; projectId?: string; limit?: number }) {
  return api<MachineRow[]>('/api/machines', { query })
}

export function getMachine(id: string) {
  return api<MachineRow>(`/api/machines/${id}`)
}

export function createMachine(body: Record<string, unknown>) {
  return api<MachineRow>('/api/machines', { method: 'POST', body })
}

export function assignMachine(id: string, body: { projectId: string; userId?: string }) {
  return api<unknown>(`/api/machines/${id}/assign`, { method: 'POST', body })
}

export function unassignMachine(id: string) {
  return api<MachineRow>(`/api/machines/${id}/unassign`, { method: 'POST' })
}

export function listTrips(query: { page?: number; projectId?: string; limit?: number }) {
  return api<TripRow[]>('/api/trips', { query })
}

export function listFuel(query: { page?: number; projectId?: string; machineId?: string }) {
  return api<FuelRow[]>('/api/fuel', { query })
}

export function listMaterials() {
  return api<CatalogRow[]>('/api/materials')
}

export function createMaterial(body: { name: string; unit: string }) {
  return api<CatalogRow>('/api/materials', { method: 'POST', body })
}

export function listDepots() {
  return api<CatalogRow[]>('/api/depots')
}

export function createDepot(body: { name: string }) {
  return api<CatalogRow>('/api/depots', { method: 'POST', body })
}

export function listPicker() {
  return api<{ id: string; name: string }[]>('/api/projects/picker')
}
