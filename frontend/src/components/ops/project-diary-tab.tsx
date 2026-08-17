import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { generateDiaryPdf, createDiary, listDiary, patchDiary } from '@/lib/api-ops'
import { ApiError } from '@/lib/api-types'
import { errorMessage } from '@/lib/error-message'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DiaryConflictSheet } from '@/components/ops/diary-conflict-sheet'

export function ProjectDiaryTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const canWrite = useHasPermission('diary.write')
  const client = useQueryClient()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [work, setWork] = useState('')
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
            }
          }}
        >
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Textarea value={work} onChange={(event) => setWork(event.target.value)} placeholder={t('diary.work')} />
          <Button type="submit">{t('common.save')}</Button>
        </form>
      ) : null}
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
                defaultValue={row.problemsNoted ?? ''}
                onBlur={async (event) => {
                  try {
                    await patchDiary(row.id, { problemsNoted: event.target.value })
                  } catch (error) {
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
