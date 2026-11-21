import { api } from '@/lib/api-client'

export type PartnerRow = {
  id: string
  type: 'CLIENT' | 'SUPPLIER'
  name: string
  taxId: string | null
  note: string | null
  isActive: boolean
}

export type CostRow = {
  id: string
  amount: string
  category: string
  date: string
  note: string | null
  source: string
  sourceId: string | null
  projectId: string | null
}

export type WarehouseRow = {
  id: string
  name: string
  type: 'SITE' | 'YARD' | 'CISTERN'
  projectId: string | null
}

export type StockRow = {
  warehouseId: string
  warehouseName: string
  warehouseType: string
  materialId: string
  materialName: string
  qty: string
}

export function listPartners() {
  return api<PartnerRow[]>('/api/partners', { query: { limit: 100 } })
}

export function createPartner(body: Record<string, unknown>) {
  return api<PartnerRow>('/api/partners', { method: 'POST', body })
}

export function listCostEntries() {
  return api<CostRow[]>('/api/cost-entries', { query: { limit: 100 } })
}

export function createCostEntry(body: Record<string, unknown>) {
  return api<CostRow>('/api/cost-entries', { method: 'POST', body })
}

export function fromPayroll(body: { year: number; month: number; projectId?: string }) {
  return api<CostRow>('/api/cost-entries/from-payroll', { method: 'POST', body })
}

export function listWarehouses() {
  return api<WarehouseRow[]>('/api/warehouses', { query: { limit: 100 } })
}

export function createWarehouse(body: Record<string, unknown>) {
  return api<WarehouseRow>('/api/warehouses', { method: 'POST', body })
}

export function listStock() {
  return api<StockRow[]>('/api/stock')
}

export function createStockMovement(body: Record<string, unknown>) {
  return api<{ id: string }>('/api/stock-movements', { method: 'POST', body })
}

export function applyFuelStock(fuelId: string, body: { warehouseId: string; materialId: string }) {
  return api<{ id: string }>(`/api/fuel/${fuelId}/apply-stock`, { method: 'POST', body })
}
