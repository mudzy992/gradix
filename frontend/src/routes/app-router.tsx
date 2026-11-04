import { Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthBootstrap } from '@/hooks/use-auth-bootstrap'
import { useLogoutSync } from '@/hooks/use-logout-sync'
import { useSocket } from '@/hooks/use-socket'
import { useAuthStore } from '@/stores/auth-store'
import { AppShell } from '@/components/layout/app-shell'
import { ScreenLoader } from '@/components/layout/screen-loader'
import {
  LazyErpPage,
  LazyFleetMapPage,
  LazyPayrollPage,
  LazyPublicSitePage,
} from '@/routes/lazy-pages'
import { ChangePasswordPage } from '@/pages/change-password-page'
import {
  CatchAllRedirect,
  PublicOnly,
  RequireAnyPermission,
  RequireAuth,
  RequirePermission,
  RequirePayroll,
} from '@/routes/guards'
import { LoginPage } from '@/pages/login-page'
import { ForgotPage } from '@/pages/forgot-page'
import { ResetPage } from '@/pages/reset-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { SettingsPage } from '@/pages/settings-page'
import { UsersPage } from '@/pages/users-page'
import { CompaniesPage } from '@/pages/companies-page'
import { ProjectsPage } from '@/pages/projects-page'
import { ProjectDetailPage } from '@/pages/project-detail-page'
import { TasksPage } from '@/pages/tasks-page'
import { TaskDetailPage } from '@/pages/task-detail-page'
import { FleetPage } from '@/pages/fleet-page'
import { LogisticsPage } from '@/pages/logistics-page'
import { DiaryPage } from '@/pages/diary-page'
import { HsePage } from '@/pages/hse-page'
import { TendersPage } from '@/pages/tenders-page'
import { ServicesPage } from '@/pages/services-page'
import { DocumentsPage } from '@/pages/documents-page'
import { ReportsPage } from '@/pages/reports-page'



function AuthedLayout() {
  useLogoutSync()
  useSocket()
  const user = useAuthStore((state) => state.user)
  if (user?.mustChangePassword) {
    return <ChangePasswordPage forced />
  }
  return <AppShell />
}

function BootGate({ children }: { children: ReactNode }) {
  useAuthBootstrap()
  const bootReady = useAuthStore((state) => state.ready)
  if (!bootReady) {
    // FE-02: umjesto „…“ — statusna regija koju čitač ekrana objavi (i spinner za vidljiv signal).
    return <ScreenLoader className="min-h-svh" />
  }
  return children
}

export const appRoutes = [
  {
    path: '/p/:slug',
    element: <LazyPublicSitePage />,
  },
  {
    element: (
      <BootGate>
        <Outlet />
      </BootGate>
    ),
    children: [
      { path: '/', element: <Navigate to="/login" replace /> },
      { path: '/login', element: <PublicOnly><LoginPage /></PublicOnly> },
      { path: '/forgot', element: <PublicOnly><ForgotPage /></PublicOnly> },
      { path: '/reset', element: <PublicOnly><ResetPage /></PublicOnly> },
      {
        element: (
          <RequireAuth>
            <AuthedLayout />
          </RequireAuth>
        ),
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          {
            path: '/projects',
            element: (
              <RequirePermission permission="projects.read">
                <ProjectsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/projects/:id',
            element: (
              <RequirePermission permission="projects.read">
                <ProjectDetailPage />
              </RequirePermission>
            ),
          },
          {
            path: '/tasks',
            element: (
              <RequireAnyPermission permissions={['tasks.read', 'tasks.dispatch']}>
                <TasksPage />
              </RequireAnyPermission>
            ),
          },
          {
            path: '/tasks/:id',
            element: (
              <RequireAnyPermission permissions={['tasks.read', 'tasks.dispatch']}>
                <TaskDetailPage />
              </RequireAnyPermission>
            ),
          },
          {
            path: '/fleet',
            element: (
              <RequirePermission permission="fleet.read">
                <FleetPage />
              </RequirePermission>
            ),
          },
          {
            path: '/fleet/map',
            element: (
              <RequirePermission permission="fleet.map">
                <LazyFleetMapPage />
              </RequirePermission>
            ),
          },
          {
            path: '/logistics',
            element: (
              <RequirePermission permission="trips.read">
                <LogisticsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/diary',
            element: (
              <RequirePermission permission="diary.read">
                <DiaryPage />
              </RequirePermission>
            ),
          },
          {
            path: '/hse',
            // F-FE-06-01 (D-033): `hse.write` bez `hse.read` vidi samo svoje prijave.
            element: (
              <RequireAnyPermission permissions={['hse.read', 'hse.write']}>
                <HsePage />
              </RequireAnyPermission>
            ),
          },
          {
            path: '/tenders',
            element: (
              <RequirePermission permission="tenders.read">
                <TendersPage />
              </RequirePermission>
            ),
          },
          {
            path: '/services',
            element: (
              <RequirePermission permission="services.read">
                <ServicesPage />
              </RequirePermission>
            ),
          },
          {
            path: '/documents',
            element: (
              <RequirePermission permission="documents.read">
                <DocumentsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/reports',
            element: (
              <RequirePermission permission="reports.read">
                <ReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/payroll',
            element: (
              <RequirePayroll>
                <LazyPayrollPage />
              </RequirePayroll>
            ),
          },
          {
            path: '/erp',
            element: (
              <RequirePermission permission="erp.read">
                <LazyErpPage />
              </RequirePermission>
            ),
          },
          {
            path: '/settings',
            element: (
              <RequirePermission permission="settings.write">
                <SettingsPage />
              </RequirePermission>
            ),
          },
          {
            path: '/users',
            element: (
              <RequirePermission permission="users.write">
                <UsersPage />
              </RequirePermission>
            ),
          },
          {
            path: '/companies',
            element: (
              <RequirePermission permission="platform.companies">
                <CompaniesPage />
              </RequirePermission>
            ),
          },
          { path: '/change-password', element: <ChangePasswordPage /> },
        ],
      },
      { path: '*', element: <CatchAllRedirect /> },
    ],
  },
]
