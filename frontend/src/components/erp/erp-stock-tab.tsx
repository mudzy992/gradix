import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createStockMovement, createWarehouse, type StockRow, type WarehouseRow } from '@/lib/api-erp'
import type { CatalogRow } from '@/lib/ops-types'
import type { MeUser } from '@/lib/api-types'
import { errorMessage } from '@/lib/error-message'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useCompanyStore } from '@/stores/company-store'
import { getSessionGeneration } from '@/lib/storage'
import { STOCK_MOVEMENT_PENDING_QUERY } from '@/lib/constants'
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

// Revision stays in the operation scope, not the cache key: after A→B→A the
// original entry remains visible, but cannot be sent under a changed revision.
function movementCacheScope(user: MeUser | null = useAuthStore.getState().user, selectedCompany: string | null = useCompanyStore.getState().selectedId): string | null {
  if (!user) return null
  const companyId = user.roles.includes('PLATFORM_ADMIN') ? selectedCompany : user.companyId
  return companyId ? JSON.stringify([getSessionGeneration(), user.id, companyId]) : null
}

type PendingMovement = { idempotencyKey: string; warehouseId: string; materialId: string; qty: string; scope: string }
type MovementRecovery = { cacheScope: string; operation: PendingMovement; inFlight: boolean; attempt: number }


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
  const client = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const selectedCompany = useCompanyStore((state) => state.selectedId)
  const cacheScope = movementCacheScope(user, selectedCompany)
  const cacheKey = [STOCK_MOVEMENT_PENDING_QUERY, cacheScope] as const
  const recovery = useQuery<MovementRecovery | null>({ queryKey: cacheKey, queryFn: async () => null, enabled: false, gcTime: Infinity }).data
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
  const observedAttempt = useRef(0)
  const boundScope = useRef(cacheScope)
  const scopeWasChanged = useRef(false)
  type MovementDraft = { warehouseId: string; materialId: string; qty: string; baseline: { warehouseId: string; materialId: string } | null }
  const parkedDraft = useRef<MovementDraft | null>(null)
  const localDraft = useRef<MovementDraft>({ warehouseId, materialId, qty, baseline: movementBaseline })
  useLayoutEffect(() => {
    localDraft.current = { warehouseId, materialId, qty, baseline: movementBaseline }
  }, [warehouseId, materialId, qty, movementBaseline])
  useLayoutEffect(() => {
    if (boundScope.current === cacheScope) return
    // Never show or edit one session/company's local state in another scope.
    boundScope.current = cacheScope
    scopeWasChanged.current = true
    pendingMovement.current = null
    parkedDraft.current = null
    movementSavingRef.current = false
    movementUncertainRef.current = false
    movementRetryEnabledRef.current = false
    observedAttempt.current = 0
    setMovementSaving(false)
    setMovementUncertain(false)
    setMovementRetryEnabled(false)
    setMovementProblem(null)
    setMovementBaseline(null)
    setWarehouseId('')
    setMaterialId('')
    setQty('')
  }, [cacheScope])
  useLayoutEffect(() => {
    if (recovery && recovery.cacheScope === cacheScope) {
      const { operation, inFlight, attempt } = recovery
      const draft = localDraft.current
      if (!scopeWasChanged.current && !pendingMovement.current && draft.baseline && (draft.qty !== '' || draft.warehouseId !== draft.baseline.warehouseId || draft.materialId !== draft.baseline.materialId)) {
        // A second view may already have its own draft; temporarily park it.
        parkedDraft.current = draft
      }
      pendingMovement.current = operation
      movementSavingRef.current = inFlight
      movementUncertainRef.current = !inFlight || attempt > 1
      if (observedAttempt.current !== attempt) {
        movementRetryEnabledRef.current = false
        setMovementRetryEnabled(false)
        observedAttempt.current = attempt
      }
      setMovementSaving(inFlight)
      setMovementUncertain(!inFlight || attempt > 1)
      setMovementBaseline((old) => old ?? { warehouseId: operation.warehouseId, materialId: operation.materialId })
      setWarehouseId(operation.warehouseId)
      setMaterialId(operation.materialId)
      setQty(operation.qty)
    } else if (pendingMovement.current) {
      // Another mounted view completed or discarded the shared operation.
      const operation = pendingMovement.current
      pendingMovement.current = null
      movementSavingRef.current = false
      movementUncertainRef.current = false
      movementRetryEnabledRef.current = false
      observedAttempt.current = 0
      setMovementSaving(false)
      setMovementUncertain(false)
      setMovementRetryEnabled(false)
      setMovementProblem(null)
      const draft = parkedDraft.current
      parkedDraft.current = null
      setWarehouseId(draft?.warehouseId ?? operation.warehouseId)
      setMaterialId(draft?.materialId ?? operation.materialId)
      setQty(draft?.qty ?? '')
      setMovementBaseline(draft?.baseline ?? { warehouseId: operation.warehouseId, materialId: operation.materialId })
    }
    scopeWasChanged.current = false
  }, [recovery, cacheScope])
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
            if (!scope || !cacheScope || movementCacheScope() !== cacheScope || (pendingMovement.current && pendingMovement.current.scope !== scope)) {
              setMovementProblem('scope')
              return
            }
            const shared = client.getQueryData<MovementRecovery | null>(cacheKey)
            // Cache is the synchronous lock across mounted views and remounts.
            if (shared?.inFlight || (shared && shared.operation.idempotencyKey !== pendingMovement.current?.idempotencyKey) || (!shared && pendingMovement.current)) return
            if (!pendingMovement.current) {
              try {
                pendingMovement.current = { idempotencyKey: crypto.randomUUID(), warehouseId, materialId, qty, scope }
              } catch {
                setMovementProblem('key')
                return
              }
            }
            const operation = pendingMovement.current
            const attempt = (shared?.attempt ?? 0) + 1
            client.setQueryData(cacheKey, { cacheScope, operation, inFlight: true, attempt } satisfies MovementRecovery)
            movementSavingRef.current = true
            movementRetryEnabledRef.current = false
            setMovementRetryEnabled(false)
            setMovementProblem(null)
            setMovementSaving(true)
            const stillOurs = () => client.getQueryData<MovementRecovery | null>(cacheKey)?.operation.idempotencyKey === operation.idempotencyKey
            try {
              await createStockMovement({
                warehouseId: operation.warehouseId,
                materialId: operation.materialId,
                qty: operation.qty,
                idempotencyKey: operation.idempotencyKey,
              })
              if (!stillOurs()) return // Session/cache was cleared; never resurrect it.
              if (movementScope() !== operation.scope) {
                client.setQueryData(cacheKey, { cacheScope, operation, inFlight: false, attempt } satisfies MovementRecovery)
                if (boundScope.current === cacheScope && movementCacheScope() === cacheScope) {
                  setMovementProblem('scope')
                  movementUncertainRef.current = true
                  setMovementUncertain(true)
                }
                return
              }
            } catch (error) {
              if (!stillOurs()) return
              client.setQueryData(cacheKey, { cacheScope, operation, inFlight: false, attempt } satisfies MovementRecovery)
              if (boundScope.current === cacheScope && movementCacheScope() === cacheScope) {
                movementUncertainRef.current = true
                setMovementUncertain(true)
                toast.error(errorMessage(error))
              }
              return
            } finally {
              if (boundScope.current === cacheScope && movementCacheScope() === cacheScope) {
                movementSavingRef.current = false
                setMovementSaving(false)
              }
            }
            client.setQueryData(cacheKey, null)
            pendingMovement.current = null
            movementUncertainRef.current = false
            setMovementUncertain(false)
            const draft = parkedDraft.current
            parkedDraft.current = null
            setWarehouseId(draft?.warehouseId ?? operation.warehouseId)
            setMaterialId(draft?.materialId ?? operation.materialId)
            setQty(draft?.qty ?? '')
            setMovementBaseline(draft?.baseline ?? { warehouseId: operation.warehouseId, materialId: operation.materialId })
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
                const current = client.getQueryData<MovementRecovery | null>(cacheKey)
                if (current?.inFlight || (current && current.operation.idempotencyKey !== pendingMovement.current?.idempotencyKey)) return
                if (current) client.setQueryData(cacheKey, null)
                const initial = warehouses.length && materials.length
                  ? {
                      warehouseId: warehouses.some((row) => row.id === movementBaseline?.warehouseId)
                        ? movementBaseline!.warehouseId : warehouses[0].id,
                      materialId: materials.some((row) => row.id === movementBaseline?.materialId)
                        ? movementBaseline!.materialId : materials[0].id,
                    }
                  : null
                const draft = parkedDraft.current
                parkedDraft.current = null
                setMovementBaseline(draft?.baseline ?? initial)
                setWarehouseId(draft?.warehouseId ?? initial?.warehouseId ?? '')
                setMaterialId(draft?.materialId ?? initial?.materialId ?? '')
                setQty(draft?.qty ?? '')
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
