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

type DiaryPayload = { workDescription?: string; date?: string; projectId?: string }

function readConflict(details: unknown): { existing?: DiaryPayload; incoming?: DiaryPayload } | null {
  if (!details || typeof details !== 'object' || !('conflictData' in details)) {
    return null
  }
  return (details as { conflictData: { existing?: DiaryPayload; incoming?: DiaryPayload } }).conflictData ?? null
}

/**
 * FE-10 — rješavanje konflikta dnevnika (dva uređaja unijela isti dan). Nalazi: ekran nije pokazivao
 * **koji datum** je u konfliktu, prazna polja su se prikazivala kao prazna (bez „—“), a kad detalji
 * nisu imali `projectId`/`date`, dugmad su **tiho radila ništa** — korisnik je kliknuo i ništa se nije
 * dogodilo. Sada: datum u naslovu, „—“ za prazan tekst i jasna poruka kad se odluka ne može poslati.
 */
export function DiaryConflictSheet({ details, open, onOpenChange, onResolved }: Props) {
  const { t } = useTranslation()
  const data = readConflict(details)
  const existing = data?.existing
  const incoming = data?.incoming
  const resolvable = Boolean(incoming?.projectId && incoming.date)
  const resolve = async (choice: 'A' | 'B' | 'MERGE') => {
    if (!incoming?.projectId || !incoming.date) {
      toast.error(t('diary.conflictNoTarget'))
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
          <SheetTitle>
            {t('diary.conflict')}
            {incoming?.date ? ` — ${incoming.date}` : ''}
          </SheetTitle>
        </SheetHeader>
        <div className="grid gap-3 p-4 text-sm">
          <p className="text-muted-foreground">{t('diary.conflictHint')}</p>
          <div className="grid gap-1">
            <p className="font-medium">{t('diary.existing')}</p>
            <p className="text-muted-foreground">{existing?.workDescription || t('projects.dash')}</p>
          </div>
          <div className="grid gap-1">
            <p className="font-medium">{t('diary.incoming')}</p>
            <p className="text-muted-foreground">{incoming?.workDescription || t('projects.dash')}</p>
          </div>
          {!resolvable ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {t('diary.conflictNoTarget')}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button variant="outline" disabled={!resolvable} onClick={() => void resolve('A')}>
              {t('diary.keepA')}
            </Button>
            <Button variant="outline" disabled={!resolvable} onClick={() => void resolve('B')}>
              {t('diary.takeB')}
            </Button>
            <Button disabled={!resolvable} onClick={() => void resolve('MERGE')}>
              {t('diary.merge')}
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
