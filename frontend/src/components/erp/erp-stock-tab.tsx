import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createStockMovement, createWarehouse, type StockRow, type WarehouseRow } from '@/lib/api-erp'
import type { CatalogRow } from '@/lib/ops-types'
import { errorMessage } from '@/lib/error-message'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
import { warehouseType } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'

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
  const dirty = name !== '' || type !== 'SITE'
  const protectedDraft = (canWrite && (dirty || uncertain)) || saving
  useCompanySwitchBlock(protectedDraft)
  useSensitiveNavigationBlock(protectedDraft)
  useLayoutEffect(() => {
    onProtectedChange(protectedDraft)
    return () => onProtectedChange(false)
  }, [onProtectedChange, protectedDraft])
  const canMove = canWrite && warehouses.length > 0 && materials.length > 0
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
          onSubmit={async (event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            try {
              await createStockMovement({
                warehouseId: String(data.get('warehouseId')),
                materialId: String(data.get('materialId')),
                qty: String(data.get('qty')),
              })
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.newMovement')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.warehouse')} htmlFor="movement-warehouse">
              <select
                id="movement-warehouse"
                name="warehouseId"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
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
              >
                {materials.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('erp.stockQty')} htmlFor="movement-qty">
              <Input id="movement-qty" name="qty" required inputMode="decimal" className="w-24" />
            </Field>
            <Button type="submit" variant="outline">
              {t('erp.moveStock')}
            </Button>
          </div>
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
