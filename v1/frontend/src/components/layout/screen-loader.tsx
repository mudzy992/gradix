import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * FE-02: jedan „čeka se“ prikaz (boot, lazy ruta). `role="status"` + `aria-live` znači da čitač
 * ekrana objavi stanje, a spinner je `aria-hidden` (dekoracija).
 */
export function ScreenLoader({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-40 flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground ${className}`}
    >
      <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden="true" />
      <span>{t('common.loading')}</span>
    </div>
  )
}
