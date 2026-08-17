import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { resolveDiaryConflict } from '@/lib/api-ops'
import { errorMessage } from '@/lib/error-message'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

type Props = {
  details: unknown
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolved: () => void
}

function readConflict(details: unknown) {
  if (!details || typeof details !== 'object' || !('conflictData' in details)) {
    return null
  }
  const data = (details as { conflictData: Record<string, unknown> }).conflictData
  return data
}

export function DiaryConflictSheet({ details, open, onOpenChange, onResolved }: Props) {
  const { t } = useTranslation()
  const data = readConflict(details)
  const existing = data?.existing as { workDescription?: string; date?: string; projectId?: string } | undefined
  const incoming = data?.incoming as { workDescription?: string; date?: string; projectId?: string } | undefined
  const resolve = async (choice: 'A' | 'B' | 'MERGE') => {
    if (!incoming?.projectId || !incoming.date) {
      return
    }
    try {
      await resolveDiaryConflict({
        entityType: 'DIARY',
        projectId: incoming.projectId,
        date: incoming.date,
        choice,
        incoming,
        mergeWork: [existing?.workDescription, incoming.workDescription].filter(Boolean).join('\n\n'),
      })
      onResolved()
      onOpenChange(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('diary.conflict')}</SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 p-4 text-sm">
          <p className="font-medium">{t('diary.existing')}</p>
          <p className="text-muted-foreground">{existing?.workDescription}</p>
          <p className="font-medium">{t('diary.incoming')}</p>
          <p className="text-muted-foreground">{incoming?.workDescription}</p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => void resolve('A')}>{t('diary.keepA')}</Button>
            <Button variant="outline" onClick={() => void resolve('B')}>{t('diary.takeB')}</Button>
            <Button onClick={() => void resolve('MERGE')}>{t('diary.merge')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
