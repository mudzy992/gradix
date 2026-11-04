import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createCostEntry, fromPayroll, type CostRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { costCategory, costSource, formatAmount } from '@/lib/labels'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/field'

const now = new Date()

type Props = {
  canWrite: boolean
  rows: CostRow[]
  isLoading: boolean
  onChanged: () => void
}

/**
 * FE-12 — troškovi. Nalazi: kategorija je bila sirov `<option>MATERIAL</option>`, izvor je prikazan
 * kao sirov `PAYROLL`/`MANUAL`, iznos je bio `120.000000`, a dva obrasca (ručni trošak i „iz obračuna“)
 * nisu imala ni zaglavlja ni labele, pa se nije znalo koji je koji.
 */
export function ErpCostsTab({ canWrite, rows, isLoading, onChanged }: Props) {
  const { t } = useTranslation()
  const CATEGORIES = ['FUEL', 'SERVICE', 'MATERIAL', 'LABOR', 'OTHER']
  return (
    <div className="grid gap-3" aria-busy={isLoading}>
      {canWrite ? (
        <form
          className="grid gap-2 rounded-md border p-3"
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
          <h2 className="text-sm font-medium">{t('erp.createCost')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.costAmount')} htmlFor="cost-amount">
              <Input id="cost-amount" name="amount" required inputMode="decimal" className="w-32" />
            </Field>
            <Field label={t('erp.categoryLabel')} htmlFor="cost-category">
              <select
                id="cost-category"
                name="category"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                defaultValue="MATERIAL"
              >
                {CATEGORIES.map((category) => {
                  const meta = costCategory(category)
                  return (
                    <option key={category} value={category}>
                      {t(meta.labelKey, { defaultValue: category })}
                    </option>
                  )
                })}
              </select>
            </Field>
            <Field label={t('erp.costDate')} htmlFor="cost-date">
              <Input id="cost-date" name="date" type="date" required className="w-40" />
            </Field>
            <Button type="submit">{t('erp.createCost')}</Button>
          </div>
        </form>
      ) : null}

      {canWrite ? (
        <form
          className="grid gap-2 rounded-md border p-3"
          onSubmit={async (event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            try {
              await fromPayroll({
                year: Number(data.get('year')),
                month: Number(data.get('month')),
              })
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <h2 className="text-sm font-medium">{t('erp.fromPayroll')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.year')} htmlFor="cost-year">
              <Input
                id="cost-year"
                name="year"
                type="number"
                min={2000}
                max={2100}
                defaultValue={now.getFullYear()}
                className="w-24"
              />
            </Field>
            <Field label={t('erp.month')} htmlFor="cost-month">
              <Input
                id="cost-month"
                name="month"
                type="number"
                min={1}
                max={12}
                defaultValue={now.getMonth() + 1}
                className="w-20"
              />
            </Field>
            <Button type="submit" variant="outline">
              {t('erp.fromPayroll')}
            </Button>
          </div>
        </form>
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('erp.costsCount', { count: rows.length })}</p>
      ) : null}

      <ul className="grid gap-2">
        {isLoading
          ? [0, 1, 2].map((index) => (
              <li key={`skeleton-${index}`}>
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
              </li>
            ))
          : rows.map((row) => {
              const category = costCategory(row.category)
              const source = costSource(row.source)
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={category.tone}>{t(category.labelKey, { defaultValue: row.category })}</Badge>
                    <span className="font-medium">{formatAmount(row.amount)}</span>
                    <span className="text-muted-foreground">{row.date.slice(0, 10)}</span>
                  </span>
                  <Badge variant={source.tone}>{t(source.labelKey, { defaultValue: row.source })}</Badge>
                </li>
              )
            })}
        {!isLoading && rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t('erp.costsEmpty')}</li>
        ) : null}
      </ul>
    </div>
  )
}
