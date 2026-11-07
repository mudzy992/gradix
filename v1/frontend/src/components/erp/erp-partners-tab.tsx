import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createPartner, type PartnerRow } from '@/lib/api-erp'
import { errorMessage } from '@/lib/error-message'
import { useCompanySwitchBlock } from '@/hooks/use-company-switch-block'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
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
  onProtectedChange: (active: boolean) => void
}

/**
 * FE-12 — partneri. Nalazi: polja su imala samo `placeholder` (nije labela), lista nije imala prazno
 * stanje ni broj, a tip partnera je bio `<option>{t('erp.CLIENT')}</option>` bez tona i bez
 * `known` zaštite za nove vrijednosti.
 */
export function ErpPartnersTab({ canWrite, rows, isLoading, onChanged, onProtectedChange }: Props) {
  const { t } = useTranslation()
  const TYPES = ['CLIENT', 'SUPPLIER']
  const [name, setName] = useState('')
  const [type, setType] = useState('CLIENT')
  const [saving, setSaving] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const savingRef = useRef(false)
  const uncertainRef = useRef(false)
  const dirty = name !== '' || type !== 'CLIENT'
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
          className="flex flex-wrap items-end gap-2"
          aria-busy={saving}
          onSubmit={async (event) => {
            event.preventDefault()
            if (savingRef.current || uncertainRef.current) return
            savingRef.current = true
            setSaving(true)
            try {
              await createPartner({ type, name })
              setName('')
              setType('CLIENT')
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
          <Field label={t('erp.type')} htmlFor="partner-type">
            <select
              id="partner-type"
              name="type"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              disabled={saving}
              value={type}
              onChange={(event) => setType(event.target.value)}
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
            <Input
              id="partner-name"
              name="name"
              required
              className="max-w-xs"
              disabled={saving}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={saving || uncertain}>{t('erp.createPartner')}</Button>
          {dirty || uncertain ? (
            <Button type="button" variant="outline" disabled={saving} onClick={() => {
              setName('')
              setType('CLIENT')
              uncertainRef.current = false
              setUncertain(false)
            }}>{t('common.discardDraft')}</Button>
          ) : null}
          {saving ? <p role="status" className="text-sm">{t('common.savingWait')}</p> : null}
          {uncertain ? (
            <div className="grid gap-2">
              <p role="alert" className="text-sm text-destructive">{t('erp.partnerUnknown')}</p>
              <Button type="button" variant="outline" onClick={() => {
                uncertainRef.current = false
                setUncertain(false)
              }}>{t('common.enableRetry')}</Button>
            </div>
          ) : null}
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
