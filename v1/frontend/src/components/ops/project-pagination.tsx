import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

type Props = {
  label: string
  page: number
  meta?: { total: number; limit: number }
  loading: boolean
  onPageChange: (page: number) => void
}

/** A failed later page still allows navigation back even when its metadata is unavailable. */
export function ProjectPagination({ label, page, meta, loading, onPageChange }: Props) {
  const { t } = useTranslation()
  const pages = meta && meta.limit > 0 ? Math.max(1, Math.ceil(meta.total / meta.limit)) : undefined
  if (page <= 1 && (!pages || pages <= 1)) return null
  return (
    <nav aria-label={label} className="flex items-center gap-2 text-sm">
      <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>{t('projects.previousPage')}</Button>
      <span>{pages ? t('projects.pageOf', { page, total: pages }) : t('projects.pageOnly', { page })}</span>
      <Button size="sm" variant="outline" disabled={!pages || page >= pages || loading} onClick={() => onPageChange(page + 1)}>{t('projects.nextPage')}</Button>
    </nav>
  )
}
