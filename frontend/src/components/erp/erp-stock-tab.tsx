import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createStockMovement, createWarehouse, type StockRow, type WarehouseRow } from '@/lib/api-erp'
import type { CatalogRow } from '@/lib/ops-types'
import { errorMessage } from '@/lib/error-message'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { getSessionGeneration } from '@/lib/storage'
import { warehouseType } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'

function movementScope(): string | null {
  const user = useAuthStore.getState().user
  if (!user) return null
  const platform = user.roles.includes('PLATFORM_ADMIN')
  const company = useCompanyStore.getState()
  const companyId = platform ? company.selectedId : user.companyId
  if (!companyId) return null
  return JSON.stringify([getSessionGeneration(), user.id, companyId, platform ? company.revision : null])
}

type PendingMovement = { idempotencyKey: string; warehouseId: string; materialId: string; qty: string; scope: string }

type Props = {
  canWrite: boolean
  warehouses: WarehouseRow[]
  materials: CatalogRow[]
  stock: StockRow[]
  isLoading: boolean
  onChanged: () => void
  onProtectedChange: (active: boolean) => void
}

/**
 * FE-12 — lager. Nalazi: dugme za knjiženje kretanja je nosilo tekst **„Količina“** (labela polja,
 * ne akcija), polja nisu imala labele, a prazne liste (bez skladišta/materijala/stavki) nisu imale
 * nikakvo objašnjenje — forma je izgledala pokvareno.
 */
export function ErpStockTab({ canWrite, warehouses, materials, stock, isLoading, onChanged, onProtectedChange }: Props) {
  const { t } = useTranslation()
  const TYPES = ['SITE', 'YARD', 'CISTERN']
  const [name, setName] = useState('')
  const [type, setType] = useState('SITE')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  const [movementBaseline, setMovementBaseline] = useState<{ warehouseId: string; materialId: string } | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [qty, setQty] = useState('')
  const [movementSaving, setMovementSaving] = useState(false)
  const [movementUncertain, setMovementUncertain] = useState(false)
  const [movementRetryEnabled, setMovementRetryEnabled] = useState(false)
  const [movementProblem, setMovementProblem] = useState<'key' | 'scope' | null>(null)
  const movementSavingRef = useRef(false)
  const movementUncertainRef = useRef(false)
  const movementRetryEnabledRef = useRef(false)
  const pendingMovement = useRef<PendingMovement | null>(null)
  useLayoutEffect(() => {
    if (movementBaseline || !warehouses.length || !materials.length) return
    const initial = { warehouseId: warehouses[0].id, materialId: materials[0].id }
    setMovementBaseline(initial)
    setWarehouseId(initial.warehouseId)
    setMaterialId(initial.materialId)
  }, [movementBaseline, warehouses, materials])
  const dirty = name !== '' || type !== 'SITE'
  const movementDirty = !!movementBaseline && (
    qty !== '' || warehouseId !== movementBaseline.warehouseId || materialId !== movementBaseline.materialId
  )
  const protectedDraft = (canWrite && (dirty || uncertain || movementDirty || movementUncertain)) || saving || movementSaving
  useCompanySwitchBlock(protectedDraft)
  useSensitiveNavigationBlock(protectedDraft)
  useLayoutEffect(() => {
    onProtectedChange(protectedDraft)
    return () => onProtectedChange(false)
  }, [onProtectedChange, protectedDraft])
  const hasWarehouse = warehouses.some((row) => row.id === warehouseId)
  const hasMaterial = materials.some((row) => row.id === materialId)
  // Retain an active draft even if a background refresh removes its selected option.
  const canMove = canWrite && !!movementBaseline && (
    (warehouses.length > 0 && materials.length > 0) || movementDirty || movementSaving || movementUncertain
  )
  return (
    <div className="grid gap-3" aria-busy={isLoading}>
      {canWrite ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          aria-busy={saving}
          onSubmit={async (event) => {
            event.preventDefault()
            if (savingRef.current || uncertainRef.current) return
            savingRef.current = true
            setSaving(true)
            try {
              await createWarehouse({ name, type })
              setName('')
              setType('SITE')
              onChanged()
            } catch (error) {
              uncertainRef.current = true
              setUncertain(true)
              toast.error(errorMessage(error))
            } finally {
              savingRef.current = false
              setSaving(false)
            }
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.newWarehouse')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.warehouseName')} htmlFor="warehouse-name">
              <Input
                id="warehouse-name"
                name="name"
                required
                className="max-w-xs"
                disabled={saving}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label={t('erp.type')} htmlFor="warehouse-type">
              <select
                id="warehouse-type"
                name="type"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                disabled={saving}
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                {TYPES.map((type) => {
                  const meta = warehouseType(type)
                  return (
                    <option key={type} value={type}>
                      {t(meta.labelKey, { defaultValue: type })}
                    </option>
                  )
                })}
              </select>
            </Field>
            <Button type="submit" disabled={saving || uncertain}>{t('erp.createWarehouse')}</Button>
            {dirty || uncertain ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => {
                setName('')
                setType('SITE')
                uncertainRef.current = false
                setUncertain(false)
              }}>{t('common.discardDraft')}</Button>
            ) : null}
          </div>
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {uncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.warehouseUnknown')}</p>
              <Button type="button" variant="outline" onClick={() => {
                uncertainRef.current = false
                setUncertain(false)
              }}>{t('common.enableRetry')}</Button>
            </div>
          ) : null}
        </form>
      ) : null}

      {canMove ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          aria-busy={movementSaving}
          onSubmit={async (event) => {
            event.preventDefault()
            if (movementSavingRef.current || (movementUncertainRef.current && !movementRetryEnabledRef.current) || !hasWarehouse || !hasMaterial) return
            const scope = movementScope()
            if (!scope || (pendingMovement.current && pendingMovement.current.scope !== scope)) {
              setMovementProblem('scope')
              return
            }
            if (!pendingMovement.current) {
              try {
                pendingMovement.current = { idempotencyKey: crypto.randomUUID(), warehouseId, materialId, qty, scope }
              } catch {
                setMovementProblem('key')
                return
              }
            }
            const operation = pendingMovement.current
            movementSavingRef.current = true
            movementRetryEnabledRef.current = false
            setMovementRetryEnabled(false)
            setMovementProblem(null)
            setMovementSaving(true)
            try {
              await createStockMovement({
                warehouseId: operation.warehouseId,
                materialId: operation.materialId,
                qty: operation.qty,
                idempotencyKey: operation.idempotencyKey,
              })
              if (movementScope() !== operation.scope) {
                setMovementProblem('scope')
                movementUncertainRef.current = true
                setMovementUncertain(true)
                return
              }
            } catch (error) {
              movementUncertainRef.current = true
              setMovementUncertain(true)
              toast.error(errorMessage(error))
              return
            } finally {
              movementSavingRef.current = false
              setMovementSaving(false)
            }
            pendingMovement.current = null
            movementUncertainRef.current = false
            setMovementUncertain(false)
            setQty('')
            setMovementBaseline({ warehouseId: operation.warehouseId, materialId: operation.materialId })
            onChanged()
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.newMovement')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.warehouse')} htmlFor="movement-warehouse">
              <select
                id="movement-warehouse"
                name="warehouseId"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                disabled={movementSaving || movementUncertain}
                value={warehouseId}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                {!hasWarehouse ? <option value={warehouseId} disabled>{t('erp.movementSelectionUnavailable')}</option> : null}
                {warehouses.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('erp.material')} htmlFor="movement-material">
              <select
                id="movement-material"
                name="materialId"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                disabled={movementSaving || movementUncertain}
                value={materialId}
                onChange={(event) => setMaterialId(event.target.value)}
              >
                {!hasMaterial ? <option value={materialId} disabled>{t('erp.movementSelectionUnavailable')}</option> : null}
                {materials.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('erp.stockQty')} htmlFor="movement-qty">
              <Input
                id="movement-qty"
                name="qty"
                required
                inputMode="decimal"
                className="w-24"
                disabled={movementSaving || movementUncertain}
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={movementSaving || (movementUncertain && !movementRetryEnabled) || !hasWarehouse || !hasMaterial}>
              {t('erp.moveStock')}
            </Button>
            {movementDirty || movementUncertain ? (
              <Button type="button" variant="outline" disabled={movementSaving} onClick={() => {
                const initial = warehouses.length && materials.length
                  ? {
                      warehouseId: warehouses.some((row) => row.id === movementBaseline?.warehouseId)
                        ? movementBaseline!.warehouseId : warehouses[0].id,
                      materialId: materials.some((row) => row.id === movementBaseline?.materialId)
                        ? movementBaseline!.materialId : materials[0].id,
                    }
                  : null
                setMovementBaseline(initial)
                setWarehouseId(initial?.warehouseId ?? '')
                setMaterialId(initial?.materialId ?? '')
                setQty('')
                pendingMovement.current = null
                movementUncertainRef.current = false
                movementRetryEnabledRef.current = false
                setMovementRetryEnabled(false)
                setMovementProblem(null)
                setMovementUncertain(false)
              }}>{t('common.discardDraft')}</Button>
            ) : null}
          </div>
          {!hasWarehouse || !hasMaterial ? <p role="alert" className="text-sm text-destructive">{t(movementUncertain ? 'erp.movementSelectionMissingUncertain' : 'erp.movementSelectionMissing')}</p> : null}
          {movementSaving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {movementProblem ? <p role="alert" className="text-sm text-destructive">{t(movementProblem === 'key' ? 'erp.movementKeyUnavailable' : 'erp.movementScopeChanged')}</p> : null}
          {movementUncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.movementUnknown')}</p>
              {!movementRetryEnabled && !movementSaving ? <Button type="button" variant="outline" onClick={() => {
                movementRetryEnabledRef.current = true
                setMovementRetryEnabled(true)
              }}>{t('common.enableRetry')}</Button> : null}
            </div>
          ) : null}
        </form>
      ) : null}

      {!isLoading && stock.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('erp.stockCount', { count: stock.length })}</p>
      ) : null}

      <ul className="grid gap-2">
        {isLoading
          ? [0, 1, 2].map((index) => (
              <li key={`skeleton-${index}`}>
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
              </li>
            ))
          : stock.map((row) => (
              <li
                key={`${row.warehouseId}-${row.materialId}`}
                className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span>
                  {row.warehouseName} · {row.materialName}
                </span>
                <span className="font-medium">{row.qty}</span>
              </li>
            ))}
        {!isLoading && stock.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            {warehouses.length === 0 ? t('erp.warehousesEmpty') : t('erp.stockEmpty')}
          </li>
        ) : null}
        {!isLoading && stock.length > 0 && materials.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t('erp.materialsEmpty')}</li>
        ) : null}
      </ul>
    </div>
  )
}
