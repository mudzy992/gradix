import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createPartner, type PartnerRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { partnerType } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/field'

type Props = {
  canWrite: boolean
  rows: PartnerRow[]
  isLoading: boolean
  onChanged: () => void
}

/**
 * FE-12 — partneri. Nalazi: polja su imala samo `placeholder` (nije labela), lista nije imala prazno
 * stanje ni broj, a tip partnera je bio `<option>{t('erp.CLIENT')}</option>` bez tona i bez
 * `known` zaštite za nove vrijednosti.
 */
export function ErpPartnersTab({ canWrite, rows, isLoading, onChanged }: Props) {
  const { t } = useTranslation()
  const TYPES = ['CLIENT', 'SUPPLIER']
  return (
    <div className="grid gap-3" aria-busy={isLoading}>
      {canWrite ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            try {
              await createPartner({
                type: String(data.get('type')),
                name: String(data.get('name')),
              })
              form.reset()
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <Field label={t('erp.type')} htmlFor="partner-type">
            <select
              id="partner-type"
              name="type"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              defaultValue="CLIENT"
            >
              {TYPES.map((type) => {
                const meta = partnerType(type)
                return (
                  <option key={type} value={type}>
                    {t(meta.labelKey, { defaultValue: type })}
                  </option>
                )
              })}
            </select>
          </Field>
          <Field label={t('erp.partnerName')} htmlFor="partner-name">
            <Input id="partner-name" name="name" required className="max-w-xs" />
          </Field>
          <Button type="submit">{t('erp.createPartner')}</Button>
        </form>
      ) : null}

      {!isLoading && rows.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('erp.partnersCount', { count: rows.length })}</p>
      ) : null}

      <ul className="grid gap-2">
        {isLoading
          ? [0, 1, 2].map((index) => (
              <li key={`skeleton-${index}`}>
                <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
              </li>
            ))
          : rows.map((row) => {
              const meta = partnerType(row.type)
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <span>{row.name}</span>
                  <Badge variant={meta.tone}>{t(meta.labelKey, { defaultValue: row.type })}</Badge>
                </li>
              )
            })}
        {!isLoading && rows.length === 0 ? (
          <li className="text-sm text-muted-foreground">{t('erp.partnersEmpty')}</li>
        ) : null}
      </ul>
    </div>
  )
}
