import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useSensitiveNavigationBlock } from '@/hooks/use-sensitive-navigation'
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

/**
 * FE-13 — privremena lozinka. Nalazi: `navigator.clipboard` se zvao bez provjere, pa bi u
 * kontekstu bez dozvole (http, stari browser) bacio **neuhvaćenu** grešku i dijalog bi izgledao
 * pokvareno. Sada: kopiranje ima fallback (tekst se označi, pa `execCommand`), a neuspjeh se kaže
 * korisniku. Lozinka je u `<code>` koji se može označiti i bez kopiranja.
 */
export function TempPasswordDialog({ password, onClose }: Props) {
  const { t } = useTranslation()
  useSensitiveNavigationBlock(Boolean(password))
  const codeRef = useRef<HTMLElement>(null)
  const copy = async (): Promise<void> => {
    if (!password) {
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password)
        toast.success(t('users.copied'))
        return
      }
      throw new Error('clipboard-unavailable')
    } catch {
      // Fallback: označi tekst da korisnik može kopirati ručno (Ctrl/Cmd+C).
      const node = codeRef.current
      const selection = window.getSelection()
      if (node && selection) {
        const range = document.createRange()
        range.selectNodeContents(node)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      toast.error(t('users.copyError'))
    }
  }
  return (
    <AlertDialog open={Boolean(password)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('users.tempTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('users.tempOnce')}</AlertDialogDescription>
        </AlertDialogHeader>
        <code
          ref={codeRef}
          className="block select-all rounded-md bg-secondary px-3 py-2 font-mono text-sm"
          aria-live="polite"
        >
          {password}
        </code>
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
