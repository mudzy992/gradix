import { AuthUser } from '../../common/types/auth-user';
import { hasRole, isCompanyWide } from '../../common/scope/ops-roles';

export type DashboardView =
  'admin' | 'pmSs' | 'driver' | 'fieldWorker' | 'mechanic';

/**
 * BE-12 (F-01): koju verziju dashboarda korisnik dobija.
 *
 * Prije su se grane provjeravale „prva koja upali“, pa je korisnik sa **više rola**
 * (npr. `PROJECT_MANAGER` + `WORKER`, ili `DRIVER` + `WORKER`) dobijao terenski
 * dashboard i gubio projekte/vozila. Sada se ide od **najšireg** ka najužem scope-u:
 * firma → PM/SS → vozač → radnik/rukovalac → mehaničar.
 */
export function resolveDashboardView(actor: AuthUser): DashboardView {
  if (isCompanyWide(actor)) {
    return 'admin';
  }
  if (hasRole(actor, 'PROJECT_MANAGER', 'SITE_SUPERVISOR')) {
    return 'pmSs';
  }
  if (hasRole(actor, 'DRIVER')) {
    return 'driver';
  }
  if (hasRole(actor, 'WORKER', 'MACHINE_OPERATOR')) {
    return 'fieldWorker';
  }
  if (hasRole(actor, 'MECHANIC')) {
    return 'mechanic';
  }
  // Neka rola izvan mape (npr. nova vrijednost enuma) — najmanje iznenađenja je
  // projektni dashboard, umjesto 500 ili praznog ekrana.
  return 'pmSs';
}
