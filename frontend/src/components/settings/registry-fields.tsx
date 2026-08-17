import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listSettings, putSettings } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import type { SettingRow } from '@/lib/api-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Draft = Record<string, string | number | boolean>

function toDraft(rows: SettingRow[]): Draft {
  return Object.fromEntries(rows.map((row) => [row.key, row.scope === 'SECRET' ? '' : row.value]))
}

export function RegistryFields() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await listSettings()).data,
  })
  const [draft, setDraft] = useState<Draft>({})
  useEffect(() => {
    if (query.data) {
      setDraft(toDraft(query.data))
    }
  }, [query.data])
  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {}
      for (const row of query.data ?? []) {
        const value = draft[row.key]
        if (row.scope === 'SECRET' && (value === '' || value === undefined)) {
          continue
        }
        body[row.key] = row.scope !== 'SECRET' && typeof row.value === 'number'
          ? Number(value)
          : value
      }
      return putSettings(body)
    },
    onSuccess: async () => {
      toast.success(t('settings.saved'))
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      await queryClient.invalidateQueries({ queryKey: ['public-settings'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.registry')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {(query.data ?? []).map((row) => (
          <div key={row.key} className="grid gap-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{row.key}</p>
                <p className="text-xs text-muted-foreground">{row.description}</p>
              </div>
              {typeof row.value === 'boolean' ? (
                <Switch
                  checked={Boolean(draft[row.key])}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, [row.key]: checked }))}
                />
              ) : null}
            </div>
            {typeof row.value !== 'boolean' ? (
              <Input
                type={row.scope === 'SECRET' ? 'password' : typeof row.value === 'number' ? 'number' : 'text'}
                value={String(draft[row.key] ?? '')}
                placeholder={row.scope === 'SECRET' ? t('settings.secretHint') : undefined}
                onChange={(event) => {
                  const raw = event.target.value
                  setDraft((current) => ({
                    ...current,
                    [row.key]: typeof row.value === 'number' ? Number(raw) : raw,
                  }))
                }}
              />
            ) : null}
          </div>
        ))}
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {t('settings.save')}
        </Button>
      </CardContent>
    </Card>
  )
}
