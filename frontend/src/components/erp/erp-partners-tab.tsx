import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createPartner, type PartnerRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  canWrite: boolean
  rows: PartnerRow[]
  onChanged: () => void
}

export function ErpPartnersTab({ canWrite, rows, onChanged }: Props) {
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
              await createPartner({ type: String(data.get('type')), name: String(data.get('name')) })
              form.reset()
              onChanged()
            } catch (error) {
              toast.error(errorMessage(error))
            }
          }}
        >
          <select name="type" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" aria-label={t('erp.type')}>
            <option value="CLIENT">{t('erp.CLIENT')}</option>
            <option value="SUPPLIER">{t('erp.SUPPLIER')}</option>
          </select>
          <Input name="name" required placeholder={t('erp.name')} className="max-w-xs" />
          <Button type="submit">{t('erp.createPartner')}</Button>
        </form>
      ) : null}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id} className="flex justify-between rounded-md border p-3 text-sm">
            <span>{row.name}</span>
            <span className="text-muted-foreground">{t(`erp.${row.type}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
