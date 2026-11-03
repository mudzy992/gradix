import { lazy, Suspense } from 'react'
import { ScreenLoader } from '@/components/layout/screen-loader'

/**
 * FE-02 (D-015, D-041): rute koje se učitavaju tek kad se otvore.
 * Odvojeno od `app-router.tsx` da taj fajl ostane čista definicija ruta (i da Fast Refresh radi —
 * `appRoutes` je konstanta, pa bi komponente u istom fajlu pravile šum u lint-u).
 */
const FleetMapLazy = lazy(() =>
  import('@/pages/fleet-map-page').then((module) => ({ default: module.FleetMapPage })),
)
const PublicSiteLazy = lazy(() =>
  import('@/pages/public-site-page').then((module) => ({ default: module.PublicSitePage })),
)
const PayrollLazy = lazy(() =>
  import('@/pages/payroll-page').then((module) => ({ default: module.PayrollPage })),
)
const ErpLazy = lazy(() =>
  import('@/pages/erp-page').then((module) => ({ default: module.ErpPage })),
)

export function LazyFleetMapPage() {
  return (
    <Suspense fallback={<ScreenLoader />}>
      <FleetMapLazy />
    </Suspense>
  )
}

export function LazyPublicSitePage() {
  return (
    <Suspense fallback={<ScreenLoader className="min-h-svh" />}>
      <PublicSiteLazy />
    </Suspense>
  )
}

export function LazyPayrollPage() {
  return (
    <Suspense fallback={<ScreenLoader />}>
      <PayrollLazy />
    </Suspense>
  )
}

export function LazyErpPage() {
  return (
    <Suspense fallback={<ScreenLoader />}>
      <ErpLazy />
    </Suspense>
  )
}
