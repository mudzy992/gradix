import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { generateDiaryPdf, createDiary, listDiary, patchDiary } from '@/lib/api-ops'
import { ApiError } from '@/lib/api-types'
import { errorMessage } from '@/lib/error-message'
import { useHasPermission } from '@/hooks/use-me'
import { useDisplayPrefs } from '@/hooks/use-public-settings'
import { formatDateTime } from '@/lib/format-date'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { DiaryConflictSheet } from '@/components/ops/diary-conflict-sheet'

export function ProjectDiaryTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const canWrite = useHasPermission('diary.write')
  const client = useQueryClient()
  const { timeZone } = useDisplayPrefs()
  const [chosenDate, setDate] = useState<string | null>(null)
  // Keep the default aligned with company settings (also when settings arrive asynchronously).
  const date = chosenDate ?? formatDateTime(new Date().toISOString(), timeZone, 'yyyy-MM-dd').slice(0, 10)
  const [work, setWork] = useState('')
  const [saving, setSaving] = useState(false)
  const fieldId = useId()
  const [conflict, setConflict] = useState<unknown>(null)
  const query = useQuery({
    queryKey: ['diary', { projectId }],
    queryFn: async () => (await listDiary({ projectId, limit: 31 })).data,
  })
  return (
    <div className="grid gap-4">
      {canWrite ? (
        <form
          className="grid gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            if (saving) return
            setSaving(true)
            try {
              await createDiary({ projectId, date, workDescription: work })
              setWork('')
              await client.invalidateQueries({ queryKey: ['diary'] })
            } catch (error) {
              if (error instanceof ApiError && error.code === 'DIARY_CONFLICT') {
                setConflict(error.details)
                return
              }
              toast.error(errorMessage(error))
            } finally {
              setSaving(false)
            }
          }}
        >
          <Label htmlFor={`${fieldId}-date`}>{t('diary.date')}</Label>
          <Input id={`${fieldId}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          <Label htmlFor={`${fieldId}-work`}>{t('diary.work')}</Label>
          <Textarea id={`${fieldId}-work`} value={work} onChange={(event) => setWork(event.target.value)} />
          <Button type="submit" disabled={saving}>{t('common.save')}</Button>
        </form>
      ) : null}
      {query.isLoading ? <p role="status">{t('common.loading')}</p> : null}
      {query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <span>{t('diary.loadError')}</span>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('dashboard.retry')}</Button>
        </div>
      ) : null}
      {query.isSuccess && query.data.length === 0 ? <p>{t('diary.noProjectEntries')}</p> : null}
      <ul className="grid gap-3 text-sm">
        {(query.data ?? []).map((row) => (
          <li key={row.id} className="rounded-md border p-3">
            <p className="font-medium">{row.date}</p>
            <p>{row.workDescription}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => generateDiaryPdf(row.id).then(() => toast.success(t('diary.pdf'))).catch((error) => toast.error(errorMessage(error)))}
            >
              {t('diary.pdf')}
            </Button>
            {canWrite ? (
              <Textarea
                className="mt-2"
                aria-label={t('diary.problemsForDate', { date: row.date })}
                defaultValue={row.problemsNoted ?? ''}
                onBlur={async (event) => {
                  const input = event.currentTarget
                  const next = input.value
                  const saved = row.problemsNoted ?? ''
                  if (next === saved) return
                  try {
                    await patchDiary(row.id, { problemsNoted: next })
                    await client.invalidateQueries({ queryKey: ['diary', { projectId }] })
                  } catch (error) {
                    if (input.value === next) input.value = saved
                    toast.error(errorMessage(error))
                  }
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {conflict ? (
        <DiaryConflictSheet
          details={conflict}
          open
          onOpenChange={(open) => !open && setConflict(null)}
          onResolved={() => void client.invalidateQueries({ queryKey: ['diary'] })}
        />
      ) : null}
    </div>
  )
}
