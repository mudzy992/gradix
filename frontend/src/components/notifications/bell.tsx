import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api'
import { errorMessage } from '@/lib/error-message'
import { formatDateTime } from '@/lib/format-date'
import { useDisplayPrefs } from '@/hooks/use-public-settings'
import { useTenantReady } from '@/hooks/use-tenant-ready'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { notifyPath } from '@/lib/notify-link'

export function Bell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const tenantReady = useTenantReady()
  const queryClient = useQueryClient()
  const prefs = useDisplayPrefs()
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await listNotifications({ unread: true, limit: 1 })).meta?.total ?? 0,
    enabled: tenantReady,
  })
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: async () => (await listNotifications({ limit: 20 })).data,
    enabled: tenantReady && open,
  })
  const markOne = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const count = unread.data ?? 0
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('bell.title')}
        disabled={!tenantReady}
        onClick={() => setOpen(true)}
        className="relative"
      >
        <BellIcon />
        {count > 0 ? (
          <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px]">{count}</Badge>
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col sm:max-w-md">
          <SheetHeader className="flex-row items-center justify-between space-y-0">
            <SheetTitle>{t('bell.title')}</SheetTitle>
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()}>
              {t('bell.markAll')}
            </Button>
          </SheetHeader>
          <ScrollArea className="mt-4 flex-1">
            {list.isLoading ? (
              <p role="status" className="px-1 text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : list.isError ? (
              <div role="alert" className="grid gap-2 px-1 text-sm text-destructive">
                <p>{t('bell.loadError')}</p>
                <Button size="sm" variant="outline" onClick={() => void list.refetch()}>{t('dashboard.retry')}</Button>
              </div>
            ) : (list.data ?? []).length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">{t('bell.empty')}</p>
            ) : (
              <ul className="grid gap-1">
                {(list.data ?? []).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-md p-3 text-left text-sm hover:bg-secondary',
                        !item.isRead && 'bg-secondary/60',
                      )}
                      onClick={() => {
                        markOne.mutate(item.id)
                        const path = notifyPath(item.type, item.data)
                        setOpen(false)
                        if (path) {
                          navigate(path)
                        }
                      }}
                    >
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground">{item.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt, prefs.timeZone, prefs.dateFormat)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  )
}
