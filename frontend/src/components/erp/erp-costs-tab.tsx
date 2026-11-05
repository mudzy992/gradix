import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createCostEntry, fromPayroll, type CostRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
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
  onProtectedChange: (active: boolean) => void
}

/**
 * FE-12 — troškovi. Nalazi: kategorija je bila sirov `<option>MATERIAL</option>`, izvor je prikazan
 * kao sirov `PAYROLL`/`MANUAL`, iznos je bio `120.000000`, a dva obrasca (ručni trošak i „iz obračuna“)
 * nisu imala ni zaglavlja ni labele, pa se nije znalo koji je koji.
 */
export function ErpCostsTab({ canWrite, rows, isLoading, onChanged, onProtectedChange }: Props) {
  const { t } = useTranslation()
  const CATEGORIES = ['FUEL', 'SERVICE', 'MATERIAL', 'LABOR', 'OTHER']
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('MATERIAL')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  const dirty = amount !== '' || category !== 'MATERIAL' || date !== ''
  const protectedDraft = (canWrite && (dirty || uncertain)) || saving
  useCompanySwitchBlock(protectedDraft)
  useSensitiveNavigationBlock(protectedDraft)
  useLayoutEffect(() => {
    onProtectedChange(protectedDraft)
    return () => onProtectedChange(false)
  }, [onProtectedChange, protectedDraft])
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
              await createCostEntry({ amount, category, date })
              setAmount('')
              setCategory('MATERIAL')
              setDate('')
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
          <h2 className="text-sm font-medium">{t('erp.createCost')}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t('erp.costAmount')} htmlFor="cost-amount">
              <Input
                id="cost-amount"
                name="amount"
                required
                inputMode="decimal"
                className="w-32"
                disabled={saving}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field label={t('erp.categoryLabel')} htmlFor="cost-category">
              <select
                id="cost-category"
                name="category"
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                disabled={saving}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
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
              <Input
                id="cost-date"
                name="date"
                type="date"
                required
                className="w-40"
                disabled={saving}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={saving || uncertain}>{t('erp.createCost')}</Button>
            {dirty || uncertain ? (
              <Button type="button" variant="outline" disabled={saving} onClick={() => {
                setAmount('')
                setCategory('MATERIAL')
                setDate('')
                uncertainRef.current = false
                setUncertain(false)
              }}>{t('common.discardDraft')}</Button>
            ) : null}
          </div>
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {uncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.costUnknown')}</p>
              <Button type="button" variant="outline" onClick={() => {
                uncertainRef.current = false
                setUncertain(false)
              }}>{t('common.enableRetry')}</Button>
            </div>
          ) : null}
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
