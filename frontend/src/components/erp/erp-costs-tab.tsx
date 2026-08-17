import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createCostEntry, fromPayroll, type CostRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const now = new Date()

type Props = {
  canWrite: boolean
  rows: CostRow[]
  onChanged: () => void
}

export function ErpCostsTab({ canWrite, rows, onChanged }: Props) {
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
              await createCostEntry({
                amount: String(data.get('amount')),
                category: String(data.get('category')),
                date: String(data.get('date')),
              })
              form.reset()
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Input name="amount" required placeholder={t('erp.amount')} className="w-28" />
          <select name="category" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('erp.category')}>
            <option value="OTHER">OTHER</option>
            <option value="MATERIAL">MATERIAL</option>
            <option value="LABOR">LABOR</option>
          </select>
          <Input name="date" type="date" required className="w-40" />
          <Button type="submit">{t('erp.createCost')}</Button>
        </form>
      ) : null}
      {canWrite ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            try {
              await fromPayroll({ year: Number(data.get('year')), month: Number(data.get('month')) })
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Input name="year" type="number" defaultValue={now.getFullYear()} className="w-24" aria-label={t('erp.year')} />
          <Input name="month" type="number" min={1} max={12} defaultValue={now.getMonth() + 1} className="w-20" aria-label={t('erp.month')} />
          <Button type="submit" variant="outline">{t('erp.fromPayroll')}</Button>
        </form>
      ) : null}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between rounded-md border p-3 text-sm">
            <span>{row.amount} · {row.category}</span>
            <span className="text-muted-foreground">{row.source}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
