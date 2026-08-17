import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  completeTask,
  getTask,
  getTimerMe,
  pauseTimer,
  resumeTimer,
  startTimer,
  stopTimer,
} from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { useHasPermission } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function TaskDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const canTimer = useHasPermission('tasks.timer')
  const canComplete = useHasPermission('tasks.write')
  const client = useQueryClient()
  const task = useQuery({
    queryKey: ['task', id],
    queryFn: async () => (await getTask(id)).data,
    enabled: Boolean(id),
  })
  const timer = useQuery({
    queryKey: ['timer', 'me'],
    queryFn: async () => (await getTimerMe()).data,
  })
  const row = task.data
  if (!row) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  const mine = timer.data?.session?.taskId === id
  const paused = Boolean(timer.data?.session?.pausedAt)
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await client.invalidateQueries({ queryKey: ['timer'] })
      await client.invalidateQueries({ queryKey: ['task', id] })
      await client.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{row.title}</h1>
      <div className="flex gap-2">
        <Badge variant="secondary">{row.status}</Badge>
        <Badge variant="outline">{row.priority}</Badge>
      </div>
      {row.description ? <p className="text-sm">{row.description}</p> : null}
      <p className="text-sm text-muted-foreground">
        {t('tasks.elapsed')}: {row.totalTimeSpentMinutes}
        {mine ? ` · ${timer.data?.elapsedMinutes ?? 0}` : ''}
      </p>
      {canTimer ? (
        <div className="flex flex-wrap gap-2">
          {!mine ? (
            <Button onClick={() => void run(() => startTimer({ taskId: id }))}>{t('tasks.start')}</Button>
          ) : paused ? (
            <Button onClick={() => void run(() => resumeTimer())}>{t('tasks.resume')}</Button>
          ) : (
            <Button onClick={() => void run(() => pauseTimer())}>{t('tasks.pause')}</Button>
          )}
          {mine ? <Button variant="outline" onClick={() => void run(() => stopTimer())}>{t('tasks.stop')}</Button> : null}
        </div>
      ) : null}
      {canComplete && row.status !== 'COMPLETED' && row.status !== 'CANCELLED' ? (
        <Button variant="outline" onClick={() => void run(() => completeTask(id))}>
          {t('tasks.complete')}
        </Button>
      ) : null}
    </div>
  )
}
