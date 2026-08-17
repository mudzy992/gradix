import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { logout, logoutAll, patchMe } from '@/lib/api'
import { broadcastLogout, clearRefreshToken, readRefreshToken } from '@/lib/storage'
import { errorMessage } from '@/lib/error-message'
import { displayName } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  if (!user) {
    return null
  }
  const handleLocale = async (locale: 'bs' | 'en'): Promise<void> => {
    try {
      const result = await patchMe({ locale })
      useAuthStore.getState().setUser(result.data)
      void i18n.changeLanguage(locale)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }
  const handleLogout = async (): Promise<void> => {
    const refresh = readRefreshToken()
    try {
      if (refresh) {
        await logout(refresh)
      }
    } catch {
      /* still leave */
    }
    useAuthStore.getState().clear()
    clearRefreshToken()
    navigate('/login', { replace: true })
  }
  const handleLogoutAll = async (): Promise<void> => {
    try {
      await logoutAll()
    } catch {
      /* still leave */
    }
    broadcastLogout()
    useAuthStore.getState().clear()
    clearRefreshToken()
    navigate('/login', { replace: true })
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="justify-start px-2">
          {displayName(user)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void handleLocale('bs')}>BS</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleLocale('en')}>EN</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/change-password')}>
          {t('auth.changePassword')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleLogout()}>{t('auth.logout')}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleLogoutAll()}>
          {t('auth.logoutAll')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
