import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listSettings, putSettings } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import type { SettingRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/field'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Brojevi se drže kao tekst dok se ne pošalju: `Number('')` je 0 i tiho bi upisao nulu. */
type Draft = Record<string, string | boolean>

function toDraft(rows: SettingRow[]): Draft {
  return Object.fromEntries(
    rows.map((row) => {
      if (row.scope === 'SECRET') {
        return [row.key, '']
      }
      if (typeof row.value === 'boolean') {
        return [row.key, row.value]
      }
      return [row.key, String(row.value)]
    }),
  )
}

/**
 * FE-13 — registar postavki. Nalazi: polja **nisu imala labelu** (uz njih je stajao goli tehnički
 * ključ kao `<p>`, pa čitač ekrana nije znao šta polje je), opisi su dolazili **na engleskom** u
 * bosanski interfejs, broj se pretvarao u `0` kad se polje isprazni, `Switch` nije imao labelu, a
 * nije bilo stanja učitavanja, greške ni praznog stanja. Sada: prevedene labele/opisi po ključu
 * (`settings.keys.<ključ>`, uz opis sa backenda kao rezervu), brojevi se validiraju pri čuvanju,
 * prazno numeričko polje se **ne** upisuje, a „Sačuvaj“ je onemogućen dok nema izmjena.
 */
export function RegistryFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await listSettings()).data,
  })
  const [draft, setDraft] = useState<Draft>({})
  const [dirty, setDirty] = useState(false)
  const [formError, setFormError] = useState('')
  useEffect(() => {
    if (query.data) {
      setDraft(toDraft(query.data))
      setDirty(false)
    }
  }, [query.data])
  const rows = useMemo(() => query.data ?? [], [query.data])
  const update = (key: string, value: string | boolean): void => {
    setDraft((current) => ({ ...current, [key]: value }))
    setDirty(true)
    setFormError('')
  }
  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {}
      for (const row of rows) {
        const value = draft[row.key]
        if (row.scope === 'SECRET') {
          if (typeof value === 'string' && value !== '') {
            body[row.key] = value
          }
          continue
        }
        if (typeof row.value === 'boolean') {
          body[row.key] = Boolean(value)
          continue
        }
        if (typeof row.value === 'number') {
          const raw = String(value ?? '').trim()
          // Prazno = „ne diraj“ (prije: `Number('')` = 0, tiho upisana nula).
          if (raw === '') {
            continue
          }
          const parsed = Number(raw)
          if (!Number.isFinite(parsed)) {
            throw new Error(t('settings.invalidNumber', { key: row.key }))
          }
          body[row.key] = parsed
          continue
        }
        body[row.key] = String(value ?? '')
      }
      return putSettings(body)
    },
    onSuccess: async () => {
      toast.success(t('settings.registrySaved'))
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['public-settings'] })
    },
    onError: (error) => {
      setFormError(errorMessage(error))
      toast.error(errorMessage(error))
    },
  })
  return (
    <Card role="region" aria-label={t('settings.registry')}>
      <CardHeader>
        <CardTitle>{t('settings.registry')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {query.isLoading ? (
          <div className="grid gap-4" aria-busy="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={`registry-skeleton-${index}`} className="grid gap-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
              </div>
            ))}
          </div>
        ) : null}

        {query.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{t('settings.registryLoadError')}</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t('dashboard.retry')}
            </Button>
          </div>
        ) : null}

        {query.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.registryEmpty')}</p>
        ) : null}

        {rows.map((row) => {
          const id = `setting-${row.key.replace(/\./g, '-')}`
          // Prevod po ključu postavke; ako ga nema, prikazuje se ključ / opis sa backenda.
          const label = t(`settings.keys.${row.key}.label`, { defaultValue: row.key })
          const description = t(`settings.keys.${row.key}.description`, { defaultValue: row.description })
          const isBoolean = typeof row.value === 'boolean'
          const isNumber = typeof row.value === 'number'
          return (
            <Field key={row.key} label={label} htmlFor={id} hint={description}>
              {isBoolean ? (
                <Switch
                  id={id}
                  checked={Boolean(draft[row.key])}
                  onCheckedChange={(checked) => update(row.key, checked)}
                />
              ) : (
                <Input
                  id={id}
                  // Broj je `text` + `inputMode`: `<input type="number">` u jsdom/browseru odbaci
                  // slova prije validacije, pa korisnik nikad ne vidi zašto vrijednost nije primljena.
                  type={row.scope === 'SECRET' ? 'password' : 'text'}
                  inputMode={isNumber ? 'decimal' : undefined}
                  autoComplete={row.scope === 'SECRET' ? 'new-password' : undefined}
                  value={String(draft[row.key] ?? '')}
                  placeholder={row.scope === 'SECRET' ? t('settings.secretHint') : undefined}
                  onChange={(event) => update(row.key, event.target.value)}
                />
              )}
            </Field>
          )
        })}

        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
              {save.isPending ? t('common.loading') : t('settings.save')}
            </Button>
            {!dirty && !save.isPending ? (
              <span className="ml-3 text-xs text-muted-foreground">{t('settings.noChanges')}</span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
