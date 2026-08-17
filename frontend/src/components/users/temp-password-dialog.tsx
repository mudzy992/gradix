import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type Props = {
  password: string | null
  onClose: () => void
}

export function TempPasswordDialog({ password, onClose }: Props) {
  const { t } = useTranslation()
  const copy = async (): Promise<void> => {
    if (!password) {
      return
    }
    await navigator.clipboard.writeText(password)
    toast.success(t('users.copied'))
  }
  return (
    <AlertDialog open={Boolean(password)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('users.tempTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('users.tempOnce')}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="rounded-md bg-secondary px-3 py-2 font-mono text-sm">{password}</p>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {t('users.copy')}
          </Button>
          <AlertDialogAction onClick={onClose}>{t('common.confirm')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
