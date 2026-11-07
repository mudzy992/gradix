import { SetMetadata } from '@nestjs/common';

export const TENANT_ROUTE_KEY = 'tenantRoute';
export const TenantRoute = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(TENANT_ROUTE_KEY, true);
