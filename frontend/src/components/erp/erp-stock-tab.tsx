import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createStockMovement, createWarehouse, type StockRow, type WarehouseRow } from '@/lib/api-erp'
import type { CatalogRow } from '@/lib/ops-types'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  canWrite: boolean
  warehouses: WarehouseRow[]
  materials: CatalogRow[]
  stock: StockRow[]
  onChanged: () => void
}

export function ErpStockTab({ canWrite, warehouses, materials, stock, onChanged }: Props) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3">
      {canWrite ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            try {
              await createWarehouse({ name: String(data.get('name')), type: String(data.get('type')) })
              form.reset()
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Input name="name" required placeholder={t('erp.name')} className="max-w-xs" />
          <select name="type" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('erp.type')}>
            <option value="YARD">{t('erp.YARD')}</option>
            <option value="CISTERN">{t('erp.CISTERN')}</option>
            <option value="SITE">{t('erp.SITE')}</option>
          </select>
          <Button type="submit">{t('erp.createWarehouse')}</Button>
        </form>
      ) : null}
      {canWrite ? (
        <form
          className="flex flex-wrap gap-2"
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
          <select name="warehouseId" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('erp.warehouse')}>
            {warehouses.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
          <select name="materialId" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('erp.material')}>
            {materials.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
          <Input name="qty" required placeholder={t('erp.qty')} className="w-24" />
          <Button type="submit" variant="outline">{t('erp.qty')}</Button>
        </form>
      ) : null}
      <ul className="grid gap-2">
        {stock.map((row) => (
          <li key={`${row.warehouseId}-${row.materialId}`} className="flex justify-between rounded-md border p-3 text-sm">
            <span>{row.warehouseName} · {row.materialName}</span>
            <span>{row.qty}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
