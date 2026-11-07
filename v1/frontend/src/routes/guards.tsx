import { useEffect, useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { canSeePayroll } from '@/lib/payroll-access'

type Props = {
  permission: string
  children: ReactNode
}

export function RequirePermission({ permission, children }: Props) {
  return (
    <RequireAnyPermission permissions={[permission]}>{children}</RequireAnyPermission>
  )
}

export function RequireAnyPermission({
  permissions,
  children,
}: {
  permissions: string[]
  children: ReactNode
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const allowed = permissions.some((permission) => user?.permissions.includes(permission))
  const toasted = useRef(false)
  useEffect(() => {
    if (!allowed && !toasted.current) {
      toasted.current = true
      toast.error(t('errors.FORBIDDEN'))
    }
  }, [allowed, t])
  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

export function RequirePayroll({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const allowed = canSeePayroll(user)
  const toasted = useRef(false)
  useEffect(() => {
    if (!allowed && !toasted.current) {
      toasted.current = true
      toast.error(t('errors.FORBIDDEN'))
    }
  }, [allowed, t])
  if (!allowed) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  const location = useLocation()
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user)
  if (user) {
    return <Navigate to="/dashboard" replace />
  }
  return children
}

export function CatchAllRedirect() {
  const user = useAuthStore((state) => state.user)
  if (user) {
    return <Navigate to="/dashboard" replace />
  }
  return <Navigate to="/login" replace />
}

